# TRD 接口说明评估维度

> 本文件源自《TRD 写作规范》（基于 100 个参数标注归因分析提炼）。归因数据：32% 标注质量取决于 TRD 写法，其中 8% 是「纯 TRD 不可替代」、24% 是「TRD 指路 + 源码精确」。
> 来源：https://uponly.larksuite.com/wiki/JzBfwnqOgiyj3Vkuy25ukSyZsMf

---

## 严重度归类

| Severity | 归因含义 | 应用范围 |
|----------|---------|---------|
| **high** | 8% 纯 TRD 不可替代——源码无法推导，不写直接空白 | 跨接口来源 / 调用链字段路径 / cursor 来源 / 全枚举值 / 错误码触发条件 |
| **medium** | 24% TRD 指路——源码可补但 TRD 提供初始线索 | DB 表.列 / 转换公式 / 精度处理 / 实现分支 / 校验层级 |
| **low** | 增强类——补则更好，缺也能推 | 字段名翻译、功能描述补充等 |

scoring 公式（每个维度 0-10）：
```
score = 10 - (high_issues × 3) - (medium_issues × 1.5) - (low_issues × 0.5)
若 < 0 取 0；若该维度 applicable=false 则 score=null
```

---

## Per-Interface 维度（每个接口都要单独评估）

### 1.1 请求参数说明列

**评估对象**：该接口请求参数表的「说明」列（逐字段检查）

**applicable 判定**：接口有请求参数表 → applicable=true；纯 GET 无参 → false

**检查项**（每个字段都要过一遍）：
- □ 参数间约束关系 — `medium`（字段合法值/行为依赖其他字段时必须标）
- □ 适用场景限制 — `medium`（仅特定方向/条件下才有意义时必须标）
- □ 跨接口来源 — **`high`**（从上游接口取值时，标注「来自 {接口名} 响应的 {字段路径}」）
- □ 不传的预期 — `medium`（必填→错误码；选填→默认值）
- □ 传空值/0 的预期 — `medium`（与不传是否等价）
- □ 传非法值的预期 + 具体错误码 — `medium`

**❌ 不符合范例**：
```
coin: 币种名称
```

**✅ 符合范例**：
```
coin: 投资币种。BuyLow 方向传 GET /product 响应的 list[].quoteCoin；
      SellHigh 方向传 list[].baseCoin。合法值取决于 orderDirection
```

**❌ 不符合范例 2**：
```
apyE8: e8 精度的 APY 值
```

**✅ 符合范例 2**：
```
apyE8: 用户可接受的最低年化收益率（e8精度）。
       传入值必须 ≤ 当前最新报价 APY；超出报价→180026（AprLowered）；不传→180001
```

---

### 2.1 响应映射汇总表（接口末尾）

**评估对象**：该接口末尾是否有「映射汇总表」（四列：响应字段 / 新鲜度 / DB 表.列 / 转换逻辑）

**applicable 判定**：接口有响应体 → applicable=true

**检查项**：
- □ 是否存在映射汇总表（不只是散落 bullet） — **`high`**
- □ 每个响应字段都覆盖 — `medium`（按字段数比例扣）
- □ 新鲜度标注：`[动态]` / `[静态]` / `[Nacos]`（可组合） — `medium`
- □ DB 列名是真实列名（不是字段翻译） — `medium`
- □ 转换逻辑写明：`÷10^8` / `.UnixMilli()` / 跨表关联 — `medium`

**❌ 不符合范例**（散落 bullet，公式错，缺新鲜度）：
```
**数据源映射**：
- duration → dual_assets_products.duration / 1440 = 天
- baseCoin → dual_assets_products.coin_y（基础币）
（缺 minPurchaseQuoteAmount / expectReceiveAt）
```

**✅ 符合范例**：

| 响应字段 | 新鲜度 | DB 表.列 | 转换逻辑 |
|---------|--------|---------|---------|
| minPurchaseQuoteAmount | [动态] | — | 来自实时价格服务，测试仅验格式 |
| expectReceiveAt | [静态]+[Nacos] | dual_assets_products.apply_end_at | + Nacos.DisplaySettlementWaitMinutes → .UnixMilli() |
| baseCoin | [静态] | dual_assets_products.coin_y → byfi.coins.coin_name | 枚举值 → 关联查询 byfi.coins |
| duration | [静态] | dual_assets_products.duration | h = duration/60；h<24 → "{h}h"，否则 "{h/24}d" |

---

### 2.2 枚举字段（说明列行内）

**评估对象**：响应/请求参数表中所有枚举类型字段的「说明」列

**applicable 判定**：该接口有枚举字段 → true；无枚举 → false

**检查项**（按枚举字段逐个）：
- □ 列出**全部**枚举值（不能只列常见的） — **`high`**
- □ 行格式 `DB整数值 → API 实际字符串`（必须用 proto/代码定义的实际枚举名，不是业务友好名） — **`high`**
- □ 标注哪些值对外不返回 — **`high`**

**❌ 不符合范例**：
```
持仓 status：Active / Redeeming
refundStatus: Processing / Processed
```

**✅ 符合范例**：
```
持仓 status：0→Active, 1→Redeeming, 2/3/4/5/6→Settled
refundStatus: REFUNDING / REFUND_DONE
product status：0→Default（对外不返回）, 1→Online（分化为 Available/NotAvailable/SoldOut）, 
                2→Offline（对外不返回）, 3→Paid（对外不返回）
```

---

### 2.3 计算字段（说明列行内）

**评估对象**：响应表中所有由公式计算得来的字段

**applicable 判定**：该接口有计算字段 → true；无计算字段 → false

**检查项**：
- □ 完整公式步骤（不是功能描述） — `medium`
- □ 完整条件分支（含 else） — `medium`
- □ 精度处理标注：`×10^8` / `÷10^8` / 截断 / 四舍五入 — `medium`
- □ 动态变量标注（哪些来自实时服务） — **`high`**

**❌ 不符合范例**：
```
duration: DB中的分钟数 / 1440 = 天
estimateApyE8: 扣除费率后的 APY
remainingAmountQuote: total_quota_x - sold_quota_x（低买方向）
```

**✅ 符合范例**：
```
duration: DB duration（分钟）→ h = duration/60；h<24 → "{h}h"，否则 "{h/24}d"
estimateApyE8 = 原始 apyE8 × (1 - fee_ratio_e8/10^8)，结果截断为整数
remainingAmountQuote: (total_quota_x - sold_quota_x) × [动态 price_per_share_e8，
                      来自实时报价服务] / 10^8；测试只能验证为正数字符串
```

---

### 3.1 实现逻辑/伪代码

**评估对象**：该接口的「实现逻辑」或「伪代码」子节

**applicable 判定**：TRD 该接口下有实现逻辑/伪代码章节 → true

**检查项**：
- □ 条件分支完整列出（含 else） — `medium`
- □ 状态/枚举映射列出全部值（含对外不暴露的） — **`high`**

**❌ 不符合范例**（只写 happy path）：
```
status 判断：在申购期内且有余额 → Available，否则 → NotAvailable
```

**✅ 符合范例**（完整分支 + 全枚举值）：
```
status 判断：
① status!=1 → NotAvailable
② is_forbidden=1 → NotAvailable
③ now < subscribe_start_at → NotAvailable
④ now > subscribe_end_at → is_vip=1 ? SoldOut : NotAvailable
⑤ else → Available
（注：不检查余额）
```

---

## Whole-Doc 维度（整篇 TRD 评估一次）

### 1.2 接口调用链 / 业务流程

**评估对象**：TRD 中的接口调用链图 / 业务流程图

**applicable 判定**：TRD 涉及多接口（≥2）→ true；单接口 TRD → false

**检查项**：
- □ 顺序依赖：箭头上标注具体字段路径（不只是接口名+泛化描述） — **`high`**
- □ 分页依赖：cursor 标注「来自上次响应的 nextPageCursor；首次不传」 — **`high`**

**❌ 不符合范例**：
```
Step 1: 查询产品 → Step 2: 获取报价 → Step 3: 下单 → Step 4: 查看订单
```

**✅ 符合范例**：
```
Step 1: GET /product → 返回 list[].productId
       ↓ productId
Step 2: GET /product-extra-info → 返回 buyLowPrice[].selectPrice / apyE8
       ↓ productId + selectPrice + apyE8
Step 3: POST /place-order（输入: productId, selectPrice, apyE8,
       coin = BuyLow ? list[].quoteCoin : list[].baseCoin）
Step 4: GET /position（分页: cursor = 上次响应的 nextPageCursor；首次不传）
```

---

### 3.2 通用过滤器链

**评估对象**：「接口总览」章节里的过滤器链描述

**applicable 判定**：TRD 有过滤器链/中间件链描述 → true；无 → false（不计入总分）

**检查项**：
- □ 列出完整执行顺序 — `medium`
- □ 每个过滤器标注负责什么校验 + 失败返回码 — **`high`**
- □ 标注哪些接口有额外过滤器（例如仅产品/报价接口） — `medium`

**❌ 不符合范例**：
```
FILTER_OPENAPI → FILTER_BIZ_LIMITER_V2 → FILTER_RESPONSE → FILTER_COMPLIANCE_WALL
· FILTER_OPENAPI — OpenAPI 鉴权
· FILTER_BIZ_LIMITER_V2 — 频率限制
（缺失败返回码）
```

**✅ 符合范例**：

| 过滤器 | 负责校验 | 失败返回码 |
|--------|---------|-----------|
| FILTER_OPENAPI | API Key 验签 | 10003 |
| FILTER_BIZ_LIMITER_V2 | 请求频率限制 | 10006 |
| FILTER_COMPLIANCE_WALL | 合规墙（KYC/地区） | 10024 |

额外过滤器（仅 GET /product, GET /product-extra-info）：FILTER_GEO_IP → 10024

---

### 3.3 错误码 + 触发场景

**评估对象**：TRD 中的错误码使用场景表

**applicable 判定**：TRD 有错误码定义 → true

**检查项**（每个错误码逐个）：
- □ 标注触发场景（不只是错误描述文字） — **`high`**
- □ 标注属于哪层校验（过滤器层 / handler 层 / 业务逻辑层） — `medium`

**❌ 不符合范例**：
```
180021: 报价已过期或无效
```

**✅ 符合范例**：
```
180021 (ErrInvalidSelectPrice): 触发条件—传入的 selectPrice 不在当前有效报价列表；
                                 业务逻辑层（在 handler 参数格式校验通过后执行）
```

---

## 评估输出 JSON 结构（sub-agent 必须严格遵守）

### Per-Interface Reviewer 输出
```json
{
  "interface_name": "POST /place-order",
  "dimensions": [
    {
      "id": "1.1",
      "name": "请求参数说明列",
      "applicable": true,
      "score": 6.5,
      "issues": [
        {
          "field": "coin",
          "severity": "high",
          "missing": "跨接口来源",
          "evidence_quote": "原 TRD：`coin: 币种名称`",
          "suggested_rewrite": "coin: 投资币种。BuyLow 方向传 GET /product 响应的 list[].quoteCoin；SellHigh 方向传 list[].baseCoin",
          "impact_note": "不写则测试无法按方向构造合法 coin，BuyLow/SellHigh 约束的校验无法覆盖"
        }
      ]
    }
    /* 其他维度 2.1 / 2.2 / 2.3 / 3.1 同结构 */
  ]
}
```

### Doc-Level Reviewer 输出
```json
{
  "dimensions": [
    {
      "id": "1.2",
      "name": "接口调用链",
      "applicable": true,
      "score": 4.0,
      "issues": [
        {
          "scope": "Step 3 → Step 4 之间",
          "severity": "high",
          "missing": "cursor 来源",
          "evidence_quote": "原 TRD：「Step 4: 查看订单」",
          "suggested_rewrite": "Step 4: GET /position（分页: cursor = 上次响应的 nextPageCursor；首次不传）",
          "impact_note": "测试不知道翻页时传什么值，分页场景永远无法被覆盖"
        }
      ]
    }
    /* 其他维度 3.2 / 3.3 同结构 */
  ]
}
```

字段语义：
- `applicable=false` 时 `score` 必须为 `null`，`issues=[]`
- `evidence_quote` 必须是从 TRD 原文复制的片段（不能虚构）
- `suggested_rewrite` 必须是「就这条问题」的最小修复，不要顺带改其他东西
- `impact_note` 简短说明这条缺失会导致什么测试问题（参考归因数据语气）
