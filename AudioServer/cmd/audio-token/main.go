package main

import (
	"flag"
	"fmt"
	"log"
	"time"

	"qing-audio-server/internal/auth"
	"qing-audio-server/internal/config"
)

func main() {
	var (
		configPath string
		userID     string
		roomID     string
		lifetime   time.Duration
	)
	flag.StringVar(&configPath, "config", "config.json", "path to JSON configuration file")
	flag.StringVar(&userID, "user", "", "game user ID")
	flag.StringVar(&roomID, "room", "", "game room ID")
	flag.DurationVar(&lifetime, "lifetime", 5*time.Minute, "token lifetime")
	flag.Parse()

	cfg, err := config.Load(configPath)
	if err != nil {
		log.Fatalf("load configuration: %v", err)
	}
	manager, err := auth.NewManager(
		cfg.Auth.HMACSecret,
		time.Duration(cfg.Auth.MaxTokenLifetimeSecs)*time.Second,
		time.Duration(cfg.Auth.AllowedClockSkewSecs)*time.Second,
	)
	if err != nil {
		log.Fatalf("initialize token manager: %v", err)
	}
	token, _, err := manager.Issue(userID, roomID, lifetime)
	if err != nil {
		log.Fatalf("issue token: %v", err)
	}
	fmt.Println(token)
}
