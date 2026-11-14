-- 靓号回归单菜单：两类号码仍各自独立管理、权限仍是两套，但后台只有一个「靓号管理」入口，
-- 进页面后用页签切换「账号ID靓号 / 俱乐部邀请码靓号」。
-- 065 建的两个独立模块隐藏停用（不删，避免历史引用悬空），权限重新挂回合并模块。

-- +xuan Statement
UPDATE mgr_module
SET name = '靓号管理', route = '/game/pretty-numbers', icon = 'pretty', sort_order = 46, visible = 1, status = 'enabled'
WHERE code = 'game.pretty_numbers'

-- +xuan Statement
UPDATE mgr_module SET visible = 0, status = 'disabled'
WHERE code IN ('game.pretty_no_uid', 'game.pretty_no_invite')

-- +xuan Statement
-- 四条按类型的权限挂回「靓号管理」模块：任一 view 权限即可看到菜单，页内再按类型控制页签与操作。
UPDATE mgr_permission
SET module_id = (SELECT id FROM mgr_module WHERE code = 'game.pretty_numbers')
WHERE code IN ('game.pretty_no.uid.view', 'game.pretty_no.uid.manage',
               'game.pretty_no.invite.view', 'game.pretty_no.invite.manage')
