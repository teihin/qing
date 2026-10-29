// xuanresea：一次性迁移工具 —— 把 mgr_automation_robot.login_password 里的
// 明文/旧密钥密文回封为当前 XUAN_CREDENTIAL_KEY 派生的 AES-256-GCM 密文。
//
// 运行：source runtime.env 后执行 ./xuanresea（加 -dry 只报告不改）。
// 用法与安全边界：
//   - v1: 且能被当前密钥解开 → 已是新密文，跳过；
//   - v1: 但当前密钥解不开 → 尝试 DB 口令派生的旧兜底密钥，能解开就重封为当前密钥；
//   - 其余非空值按明文处理，直接封为当前密钥密文。
// 跑完后库里不应再有非 v1: 前缀的非空密码。
package main

import (
	"database/sql"
	"flag"
	"fmt"
	"log"
	"strings"

	"xuanmanager/internal/config"
	"xuanmanager/internal/security"
)

func main() {
	dryRun := flag.Bool("dry", false, "只报告不写库")
	flag.Parse()

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("读取配置失败: %v", err)
	}
	if cfg.CredentialKey == "" {
		log.Fatal("XUAN_CREDENTIAL_KEY 未设置")
	}
	newKey := security.DeriveCredentialKey(cfg.CredentialKey)
	fallbackKey := security.DeriveCredentialKey(cfg.DBPassword)

	db, err := sql.Open("mysql", cfg.MySQLDSN())
	if err != nil {
		log.Fatalf("打开数据库失败: %v", err)
	}
	defer db.Close()

	rows, err := db.Query("SELECT id, account, login_password FROM mgr_automation_robot WHERE login_password <> ''")
	if err != nil {
		log.Fatalf("查询机器人失败: %v", err)
	}
	defer rows.Close()

	type work struct {
		id       int64
		account  string
		sealed   string
		action   string
	}
	var works []work
	unresolved := 0
	for rows.Next() {
		var id int64
		var account, sealed string
		if err := rows.Scan(&id, &account, &sealed); err != nil {
			log.Fatalf("读取行失败: %v", err)
		}
		sealed = strings.TrimSpace(sealed)
		if sealed == "" {
			continue
		}
		if strings.HasPrefix(sealed, "v1:") {
			if plain, err := security.OpenCredential(newKey, sealed); err == nil {
				log.Printf("跳过 id=%d %s：已是当前密钥密文（解出 %d 字符）", id, account, len(plain))
				continue
			}
			plain, err := security.OpenCredential(fallbackKey, sealed)
			if err != nil {
				log.Printf("无法处理 id=%d %s：当前密钥与旧兜底密钥都解不开，保持原值不动", id, account)
				unresolved++
				continue
			}
			resealed, err := security.SealCredential(newKey, plain)
			if err != nil {
				log.Fatalf("重封 id=%d 失败: %v", id, err)
			}
			works = append(works, work{id, account, resealed, "旧密钥密文→当前密钥密文"})
		} else {
			sealedNew, err := security.SealCredential(newKey, sealed)
			if err != nil {
				log.Fatalf("封装 id=%d 失败: %v", id, err)
			}
			works = append(works, work{id, account, sealedNew, "明文→密文"})
		}
	}
	if err := rows.Err(); err != nil {
		log.Fatalf("遍历行失败: %v", err)
	}

	if *dryRun {
		for _, w := range works {
			log.Printf("[dry] id=%d %s 将执行：%s", w.id, w.account, w.action)
		}
		log.Printf("[dry] 待处理 %d 行，无法处理 %d 行；未写库", len(works), unresolved)
		return
	}

	tx, err := db.Begin()
	if err != nil {
		log.Fatalf("开始事务失败: %v", err)
	}
	for _, w := range works {
		if _, err := tx.Exec("UPDATE mgr_automation_robot SET login_password = ? WHERE id = ?", w.sealed, w.id); err != nil {
			tx.Rollback()
			log.Fatalf("更新 id=%d 失败: %v", w.id, err)
		}
		log.Printf("id=%d %s：%s", w.id, w.account, w.action)
	}
	if err := tx.Commit(); err != nil {
		log.Fatalf("提交失败: %v", err)
	}
	fmt.Printf("完成：处理 %d 行，无法处理 %d 行\n", len(works), unresolved)
}
