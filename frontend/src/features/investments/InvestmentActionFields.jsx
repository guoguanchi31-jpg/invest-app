import FormField from "../../components/FormField";
import { originalMoney, tradePreview } from "../../settlement";


function HoldingFields({
  actionMode,
  form,
  handleChange,
  renderAccountOwnerOptions,
  renderInvestmentAccountOptions,
}) {
  return (
    <>
      <FormField label="持仓名称" help="显示在投资理财持仓列表中。">
        <input name="name" placeholder="例如：贵州茅台 / 沪深300ETF" value={form.name} onChange={handleChange} />
      </FormField>
      <FormField label="证券代码" help="用于线上行情匹配，请尽量填写标准代码。">
        <input name="code" placeholder="例如：600519 / 001186 / AAPL" value={form.code} onChange={handleChange} />
      </FormField>
      <FormField label="资产类型" help="股票和基金会尝试自动刷新行情。">
        <select name="asset_type" value={form.asset_type} onChange={handleChange}>
          <option value="stock">股票</option>
          <option value="fund">基金</option>
          <option value="bond">债券</option>
          <option value="gold">黄金 / 商品</option>
        </select>
      </FormField>
      <FormField label="用户" help="先选择持仓归属大宝还是小宝。">
        <select name="account_owner" value={form.account_owner} onChange={handleChange}>
          {renderAccountOwnerOptions()}
        </select>
      </FormField>
      <FormField label="账户名称" help="只展示所选用户的投资账户。">
        <select name="account_id" value={form.account_id} onChange={handleChange}>
          <option value="">选择投资账户</option>
          {renderInvestmentAccountOptions(form.account_owner)}
        </select>
      </FormField>
      <FormField label="交易市场" help="不确定时可保持自动识别；美股请选美股。">
        <select name="market" value={form.market} onChange={handleChange}>
          <option value="">自动识别市场</option>
          <option value="sh">上海 A 股</option>
          <option value="sz">深圳 A 股</option>
          <option value="bj">北京证券交易所</option>
          <option value="hk">港股</option>
          <option value="us">美股</option>
        </select>
      </FormField>
      <FormField label="计价币种" help="持仓价格使用的原始币种，例如 CNY、HKD、USD。">
        <input name="currency" maxLength="3" placeholder="CNY" value={form.currency} onChange={handleChange} />
      </FormField>
      <FormField label="兑人民币汇率" help="1 单位原币可兑换的人民币金额，用于统一汇总。">
        <input
          name="exchange_rate_to_base"
          inputMode="decimal"
          data-decimal-scale={6}
          placeholder="例如：7.12"
          value={form.exchange_rate_to_base}
          onChange={handleChange}
        />
      </FormField>
      {actionMode === "holding" ? (
        <>
          <FormField label="买入均价" help="用于计算持仓成本和累计盈亏。">
            <input
              name="buy_price"
              inputMode="decimal"
              data-decimal-scale={6}
              data-number-suffix={` ${form.currency || "CNY"}`}
              placeholder="例如：12.35"
              value={form.buy_price}
              onChange={handleChange}
            />
          </FormField>
          <FormField label="持仓数量" help="股票填写股数，基金填写份额。">
            <input
              name="quantity"
              inputMode="decimal"
              data-decimal-scale={6}
              placeholder="例如：1000"
              value={form.quantity}
              onChange={handleChange}
            />
          </FormField>
          {["stock", "fund"].includes(form.asset_type) ? (
            <div className="form-hint-card wide">
              <strong>
                {form.asset_type === "fund"
                  ? "基金净值由线上行情自动刷新"
                  : "股票现价由线上行情自动刷新"}
              </strong>
              <span>股票支持 A 股、港股、美股多源行情；基金支持天天基金估值。保存后会自动刷新，也可以点击“刷新行情”手动更新。</span>
            </div>
          ) : (
            <FormField label="当前价格 / 净值" help="该资产暂未接入自动行情，需要手动维护估值。">
              <input
                name="current_price"
                inputMode="decimal"
                data-decimal-scale={6}
                data-number-suffix={` ${form.currency || "CNY"}`}
                placeholder="例如：510.00"
                value={form.current_price}
                onChange={handleChange}
              />
            </FormField>
          )}
        </>
      ) : null}
    </>
  );
}


function TradeFields({
  actionMode,
  form,
  getAccountById,
  handleChange,
  renderDateButton,
}) {
  const preview = tradePreview(form, getAccountById(form.account_id));
  return (
    <>
      <div className="form-hint-card wide">
        <strong>{form.name || "首次买入"}</strong>
        <span>
          {form.code} · {form.trade_type === "buy"
            ? "买入会扣减投资账户现金"
            : "卖出会增加投资账户现金"}
        </span>
      </div>
      {actionMode === "trade" ? (
        <FormField label="交易方向">
          <select name="trade_type" value={form.trade_type} onChange={handleChange}>
            <option value="buy">买入</option>
            <option value="sell">卖出</option>
          </select>
        </FormField>
      ) : null}
      <FormField label="数量">
        <input
          name="quantity"
          inputMode="decimal"
          data-decimal-scale={6}
          placeholder="0"
          value={form.quantity}
          onChange={handleChange}
        />
      </FormField>
      <FormField label="成交价格">
        <input
          name="price"
          inputMode="decimal"
          data-decimal-scale={6}
          data-number-suffix={` ${preview.currency}`}
          placeholder="0.00"
          value={form.price}
          onChange={handleChange}
        />
      </FormField>
      <FormField label="手续费" help={`使用标的计价币种 ${preview.currency}`}>
        <input
          name="fee"
          inputMode="decimal"
          data-number-suffix={` ${preview.currency}`}
          placeholder="0.00"
          value={form.fee}
          onChange={handleChange}
        />
      </FormField>
      {!preview.sameCurrency ? (
        <FormField
          label="实际结算汇率"
          help={`1 ${preview.currency} 对应多少 ${preview.cashCurrency}；用于本次现金收付。`}
        >
          <input
            name="settlement_rate"
            inputMode="decimal"
            data-decimal-scale={6}
            placeholder="按券商实际结算填写"
            value={form.settlement_rate}
            onChange={handleChange}
          />
        </FormField>
      ) : null}
      <div className="form-hint-card wide" aria-live="polite">
        <strong>
          成交额 {originalMoney(preview.gross || 0, preview.currency)}
          {" · "}
          手续费 {originalMoney(preview.fee || 0, preview.currency)}
        </strong>
        {preview.valid ? (
          <>
            <span>
              现金{preview.cashChange < 0 ? "扣减" : "增加"}{" "}
              {originalMoney(Math.abs(preview.cashChange), preview.cashCurrency)}
            </span>
            <span className={preview.remaining < 0 ? "negative" : ""}>
              交易后现金可投 {originalMoney(preview.remaining, preview.cashCurrency)}
              {preview.remaining < 0 ? "，现金不足" : ""}
            </span>
          </>
        ) : (
          <span>填写数量、成交价及结算信息后显示现金变化。</span>
        )}
        <span>成交价用于记录成本，已有持仓的当前行情独立更新。</span>
      </div>
      {renderDateButton({ field: "occurred_at", label: "交易日期" })}
      <FormField label="备注">
        <input name="note" placeholder="可选" value={form.note} onChange={handleChange} />
      </FormField>
    </>
  );
}


export default function InvestmentActionFields(props) {
  return (
    <>
      {["holding", "new_trade"].includes(props.actionMode)
        ? <HoldingFields {...props} />
        : null}
      {["trade", "new_trade"].includes(props.actionMode)
        ? <TradeFields {...props} />
        : null}
    </>
  );
}
