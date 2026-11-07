package api

import "testing"

const (
	sampleGameCallLine = `{"time":"2026-11-07T18:29:54.497891855+08:00","level":"INFO","msg":"[游戏服调用] GET /hall/command | 命令=异步_查询_代理_展示数据 | 参数={\"agent_id\":\"895742\"}","route":"/hall/command","header":"异步_查询_代理_展示数据","params":"{\"agent_id\":\"895742\",\"metric\":\"contrib\"}"}`
	sampleGameResultLine = `{"time":"2026-11-07T18:29:54.588272406+08:00","level":"INFO","msg":"[游戏服返回] GET /hall/command | 命令=异步_查询_代理_展示数据 | HTTP=200 | ret_code=512 (0x200) | ret_result={\"agent_id\":\"895742\"} | 耗时=90ms","route":"/hall/command","header":"异步_查询_代理_展示数据","params":"{\"agent_id\":\"895742\"}","http_status":200,"ret_code":512,"ret_result":"{\"agent_id\":\"895742\"}","duration_ms":90}`
	sampleGameErrorLine  = `{"time":"2026-11-07T18:30:00.100000000+08:00","level":"ERROR","msg":"[游戏服调用失败] GET /hall/command | 命令=设置_大厅_配置数据 | 参数={} | 错误=dial tcp 127.0.0.1:8890: connect: connection refused | 耗时=3ms","route":"/hall/command","header":"设置_大厅_配置数据","params":"{}","error":"dial tcp 127.0.0.1:8890: connect: connection refused","duration_ms":3}`
)

func TestParseGameCallLogLine(t *testing.T) {
	call, ok := parseGameCallLogLine(sampleGameCallLine)
	if !ok {
		t.Fatal("调用日志没有被解析")
	}
	if call.Kind != "call" || call.Command != "异步_查询_代理_展示数据" {
		t.Fatalf("调用日志字段不正确: %+v", call)
	}
	if call.Params != `{"agent_id":"895742","metric":"contrib"}` {
		t.Fatalf("调用日志参数应取 slog 的 params 字段: %q", call.Params)
	}

	result, ok := parseGameCallLogLine(sampleGameResultLine)
	if !ok {
		t.Fatal("返回日志没有被解析")
	}
	if result.Kind != "result" || result.RetCode != "512" || result.DurationMS != "90" || result.HTTPStatus != "200" {
		t.Fatalf("返回日志字段不正确: %+v", result)
	}
	if result.Result != `{"agent_id":"895742"}` {
		t.Fatalf("返回日志结果不正确: %q", result.Result)
	}

	failure, ok := parseGameCallLogLine(sampleGameErrorLine)
	if !ok {
		t.Fatal("失败日志没有被解析")
	}
	if failure.Kind != "error" || failure.Error == "" {
		t.Fatalf("失败日志应标记为 error 并保留原因: %+v", failure)
	}
}

func TestParseGameCallLogLineSkipsFrontendRequests(t *testing.T) {
	// 前端调后台自己的请求不是 slog 输出，即使被写进日志也不应该出现在游戏接口日志里。
	if _, ok := parseGameCallLogLine(`{"time":"2026-11-07T18:29:54Z","level":"INFO","msg":"GET /api/agent-contribution/list"}`); ok {
		t.Fatal("非游戏服日志不应被解析")
	}
}

func TestParseGameCallLogLinesKeepsLatest(t *testing.T) {
	entries := parseGameCallLogLines([]string{sampleGameCallLine, sampleGameResultLine, sampleGameErrorLine}, 2)
	if len(entries) != 2 {
		t.Fatalf("应只保留最近 2 条，实际 %d", len(entries))
	}
	if entries[1].Kind != "error" {
		t.Fatalf("最后一条应是失败日志，实际 %+v", entries[1])
	}
}
