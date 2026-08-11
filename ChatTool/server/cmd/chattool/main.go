package main

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"chattool/internal/api"
	"chattool/internal/config"
	"chattool/migrations"

	_ "github.com/go-sql-driver/mysql"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	cfg, err := config.Load()
	if err != nil {
		logger.Error("配置不正确", "error", err)
		os.Exit(1)
	}
	if err := os.MkdirAll(cfg.UploadDir, 0o700); err != nil {
		logger.Error("无法创建媒体存储目录", "error", err)
		os.Exit(1)
	}
	db, err := sql.Open("mysql", cfg.MySQLDSN())
	if err != nil {
		logger.Error("无法初始化数据库", "error", err)
		os.Exit(1)
	}
	defer db.Close()
	db.SetMaxOpenConns(30)
	db.SetMaxIdleConns(10)
	db.SetConnMaxLifetime(5 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	if err := db.PingContext(ctx); err != nil {
		cancel()
		logger.Error("数据库连接失败", "error", err)
		os.Exit(1)
	}
	if err := migrations.Apply(ctx, db); err != nil {
		cancel()
		logger.Error("数据库迁移失败", "error", err)
		os.Exit(1)
	}
	if err := migrations.BootstrapSupervisor(ctx, db, cfg.BootstrapUser, cfg.BootstrapPassword, cfg.BootstrapName); err != nil {
		cancel()
		logger.Error("初始客服主管创建失败", "error", err)
		os.Exit(1)
	}
	cancel()

	app := api.New(db, cfg, logger)
	maintenanceCtx, stopMaintenance := context.WithCancel(context.Background())
	app.StartMaintenance(maintenanceCtx)
	server := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           app,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
		MaxHeaderBytes:    1 << 20,
	}
	go func() {
		logger.Info("ChatTool 客服服务已启动", "addr", cfg.HTTPAddr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("HTTP 服务异常退出", "error", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	stopMaintenance()
	app.StopLiveEvents()
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer shutdownCancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("服务优雅停止失败", "error", err)
	}
}
