package main

import (
	"context"
	"crypto/tls"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"qing-audio-server/internal/api"
	"qing-audio-server/internal/audio"
	"qing-audio-server/internal/auth"
	"qing-audio-server/internal/config"
	"qing-audio-server/internal/metrics"
	"qing-audio-server/internal/service"
	"qing-audio-server/internal/store"
)

const version = "0.1.0"

func main() {
	var (
		configPath  string
		showVersion bool
	)
	flag.StringVar(&configPath, "config", "config.json", "path to JSON configuration file")
	flag.BoolVar(&showVersion, "version", false, "print version and exit")
	flag.Parse()

	if showVersion {
		fmt.Println(version)
		return
	}

	logger := log.New(os.Stdout, "audio-server ", log.LstdFlags|log.LUTC|log.Lmsgprefix)
	cfg, err := config.Load(configPath)
	if err != nil {
		logger.Fatalf("load configuration: %v", err)
	}

	tokenManager, err := auth.NewManager(
		cfg.Auth.HMACSecret,
		time.Duration(cfg.Auth.MaxTokenLifetimeSecs)*time.Second,
		time.Duration(cfg.Auth.AllowedClockSkewSecs)*time.Second,
	)
	if err != nil {
		logger.Fatalf("initialize token manager: %v", err)
	}

	fileStorage, err := store.NewFileStorage(cfg.Storage.RootDirectory)
	if err != nil {
		logger.Fatalf("initialize file storage: %v", err)
	}
	metadataRoot := filepath.Join(cfg.Storage.RootDirectory, cfg.Storage.MetadataDirectoryName)
	metadataStore, err := store.NewFileMetadataStore(metadataRoot)
	if err != nil {
		logger.Fatalf("initialize metadata store: %v", err)
	}

	encoderFactory := audio.NewFFmpegFactory(
		cfg.Audio.FFmpegPath,
		cfg.Audio.SampleRate,
		cfg.Audio.Channels,
		cfg.Audio.Bitrate,
	)
	if err := encoderFactory.Check(); err != nil {
		logger.Fatalf("initialize encoder: %v", err)
	}

	serviceMetrics := &metrics.Metrics{}
	voiceService, err := service.NewVoiceService(
		service.Config{
			SampleRate:          cfg.Audio.SampleRate,
			Channels:            cfg.Audio.Channels,
			MinDurationMS:       cfg.Audio.MinDurationMS,
			MaxDurationMS:       cfg.Audio.MaxDurationMS,
			MaxFrameBytes:       cfg.Audio.MaxFrameBytes,
			Retention:           cfg.Retention(),
			MaxActiveRecordings: cfg.Limits.MaxActiveRecordings,
			IDSecret:            cfg.Auth.HMACSecret,
		},
		encoderFactory,
		fileStorage,
		metadataStore,
		serviceMetrics,
	)
	if err != nil {
		logger.Fatalf("initialize voice service: %v", err)
	}

	apiServer := api.NewServer(cfg, tokenManager, voiceService, serviceMetrics, logger)
	handler := apiServer.Handler()

	rootContext, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go runCleanup(rootContext, cfg, voiceService, logger)

	servers := make([]*http.Server, 0, 2)
	errorChannel := make(chan error, 2)
	if cfg.Server.HTTPAddress != "" {
		plainServer := newHTTPServer(cfg.Server.HTTPAddress, handler, cfg)
		servers = append(servers, plainServer)
		logger.Printf("starting HTTP/WS listener address=%s warning=traffic_is_not_encrypted", cfg.Server.HTTPAddress)
		go func() {
			if err := plainServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
				errorChannel <- fmt.Errorf("HTTP listener: %w", err)
			}
		}()
	}
	if cfg.Server.HTTPSAddress != "" {
		tlsServer := newHTTPServer(cfg.Server.HTTPSAddress, handler, cfg)
		tlsServer.TLSConfig = &tls.Config{
			MinVersion: tls.VersionTLS12,
		}
		servers = append(servers, tlsServer)
		logger.Printf("starting HTTPS/WSS listener address=%s", cfg.Server.HTTPSAddress)
		go func() {
			if err := tlsServer.ListenAndServeTLS(cfg.Server.TLSCertFile, cfg.Server.TLSKeyFile); err != nil &&
				!errors.Is(err, http.ErrServerClosed) {
				errorChannel <- fmt.Errorf("HTTPS listener: %w", err)
			}
		}()
	}

	select {
	case <-rootContext.Done():
		logger.Printf("shutdown signal received")
	case err := <-errorChannel:
		logger.Printf("listener failed: %v", err)
		stop()
	}

	shutdownContext, cancelShutdown := context.WithTimeout(context.Background(), cfg.ShutdownTimeout())
	defer cancelShutdown()
	for _, server := range servers {
		if err := server.Shutdown(shutdownContext); err != nil {
			logger.Printf("graceful shutdown error address=%s error=%v", server.Addr, err)
			_ = server.Close()
		}
	}
	logger.Printf("server stopped")
}

func newHTTPServer(address string, handler http.Handler, cfg config.Config) *http.Server {
	return &http.Server{
		Addr:              address,
		Handler:           handler,
		ReadHeaderTimeout: cfg.ReadHeaderTimeout(),
		IdleTimeout:       cfg.IdleTimeout(),
		MaxHeaderBytes:    16 * 1024,
	}
}

func runCleanup(ctx context.Context, cfg config.Config, voices *service.VoiceService, logger *log.Logger) {
	run := func() {
		deletedVoices, deletedPartials, err := voices.Cleanup(time.Now().UTC(), cfg.PartialMaxAge())
		if err != nil {
			logger.Printf("storage cleanup failed: %v", err)
			return
		}
		if deletedVoices > 0 || deletedPartials > 0 {
			logger.Printf("storage cleanup completed deleted_voices=%d deleted_partials=%d", deletedVoices, deletedPartials)
		}
	}
	run()

	ticker := time.NewTicker(cfg.CleanupInterval())
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			run()
		}
	}
}
