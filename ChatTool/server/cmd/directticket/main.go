// 命令 directticket 为联调签发票据。
//
// 正式方案里票据由游戏服在玩家登录后签发；在一期 KB 命令尚未上线前，
// 运维/测试可用本工具在服务器本机签发票据，验证客户端与接口链路。
// 密钥只从运行环境读取，不落盘、不写日志。
//
//	CHAT_DIRECT_TICKET_KEY='...' ./directticket -guuid 100001 -name 玩家一 -ttl 10m
package main

import (
	"flag"
	"fmt"
	"os"
	"time"

	"chattool/internal/directchat"
)

func main() {
	guuid := flag.String("guuid", "", "玩家 guuid")
	name := flag.String("name", "", "玩家昵称")
	ttl := flag.Duration("ttl", 10*time.Minute, "票据有效期")
	flag.Parse()
	key := os.Getenv("CHAT_DIRECT_TICKET_KEY")
	if len(key) < 16 {
		fmt.Fprintln(os.Stderr, "必须通过 CHAT_DIRECT_TICKET_KEY 提供至少 16 个字符的密钥")
		os.Exit(1)
	}
	if *guuid == "" {
		fmt.Fprintln(os.Stderr, "-guuid 必填")
		os.Exit(1)
	}
	ticket, err := directchat.NewTicketIssuer([]byte(key), *ttl).Issue(*guuid, *name, "")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println(ticket)
}
