-- 菜单顺序：联盟管理放到俱乐部管理之前（玩家管理之后）。
-- +xuan Statement
UPDATE mgr_module SET sort_order = CASE code
  WHEN 'game.unions' THEN 25
  WHEN 'game.clubs' THEN 26
  ELSE sort_order
END
WHERE code IN ('game.unions', 'game.clubs')
