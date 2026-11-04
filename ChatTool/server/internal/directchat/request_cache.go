package directchat

import "context"

// requestCache 只在单次 HTTP 请求内复用游戏库查询结果。
//
// 会话列表会逐条把会话转成视图，同一俱乐部、同一成员、同一联盟会被
// 反复读取；没有缓存时一次列表请求会产生上百次 SELECT（其中每次成员
// 查询还会整表读取俱乐部的代理关系）。这里按请求缓存，不跨请求保留，
// 因此不会让权限/成员关系出现跨请求的陈旧窗口。
type requestCache struct {
	clubs     map[string]clubLookup
	unions    map[string]unionLookup
	accounts  map[string]accountLookup
	members   map[string]memberLookup
	relations map[string]relationsLookup
}

type clubLookup struct {
	club Club
	err  error
}

type unionLookup struct {
	union Union
	ok    bool
	err   error
}

type accountLookup struct {
	user GameUser
	ok   bool
	err  error
}

type memberLookup struct {
	member Member
	ok     bool
	err    error
}

type relationsLookup struct {
	relations map[string]agentRelation
	err       error
}

type requestCacheKey struct{}

// WithRequestCache 为一次请求建立关系查询缓存。
func WithRequestCache(ctx context.Context) context.Context {
	return context.WithValue(ctx, requestCacheKey{}, &requestCache{
		clubs:     map[string]clubLookup{},
		unions:    map[string]unionLookup{},
		accounts:  map[string]accountLookup{},
		members:   map[string]memberLookup{},
		relations: map[string]relationsLookup{},
	})
}

func requestCacheFrom(ctx context.Context) *requestCache {
	cache, _ := ctx.Value(requestCacheKey{}).(*requestCache)
	return cache
}
