-- 付款页的「输入其他金额」默认关掉：绝大多数客服场景只要档位按钮，
-- 允许玩家自由填金额容易被拆单、也容易填错。需要时按通道单独打开。
-- +xuan Statement
ALTER TABLE mgr_pay_channel
  ADD COLUMN allow_custom TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1=付款页允许输入自定义金额' AFTER require_payer
