package main

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"xuanmanager/internal/api"
	"xuanmanager/internal/config"
	"xuanmanager/migrations"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	cfg, err := config.Load()
	if err != nil {
		logger.Error("configuration error", "error", err)
		os.Exit(1)
	}

	db, err := sql.Open("mysql", cfg.MySQLDSN())
	if err != nil {
		logger.Error("open database", "error", err)
		os.Exit(1)
	}
	defer db.Close()
	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		logger.Error("database unavailable", "error", err)
		os.Exit(1)
	}
	gameDB, err := sql.Open("mysql", cfg.GameMySQLDSN())
	if err != nil {
		logger.Error("open game database", "error", err)
		os.Exit(1)
	}
	defer gameDB.Close()
	gameDB.SetMaxOpenConns(5)
	gameDB.SetMaxIdleConns(2)
	gameDB.SetConnMaxLifetime(5 * time.Minute)
	if err := gameDB.PingContext(ctx); err != nil {
		logger.Error("game database unavailable", "error", err)
		os.Exit(1)
	}
	if err := migrations.Apply(ctx, db); err != nil {
		logger.Error("database migration failed", "error", err)
		os.Exit(1)
	}
	if err := migrations.BootstrapAdmin(ctx, db, cfg); err != nil {
		logger.Error("bootstrap administrator failed", "error", err)
		os.Exit(1)
	}

	server := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           api.NewWithGameDB(db, gameDB, cfg, logger),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		logger.Info("XuanManager started", "address", cfg.HTTPAddr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("server stopped unexpectedly", "error", err)
			os.Exit(1)
		}
	}()

	<-stop
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	_ = server.Shutdown(shutdownCtx)
	logger.Info("XuanManager stopped")
}
