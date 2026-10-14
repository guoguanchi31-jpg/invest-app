import { CircleMinus, CirclePlus, Pencil } from "lucide-react";
import DialogActions, { DialogAction } from "../../components/DialogActions";
import ModalBackdrop from "../../components/ModalBackdrop";
import ModalPanel from "../../components/ModalPanel";

export default function HoldingDetailDialog({
  formatMoney,
  holding,
  onClose,
  onEdit,
  onTrade,
}) {
  if (!holding) return null;
  const profitClass = holding.profit >= 0 ? "positive" : "negative";
  const quantity = Number(holding.quantity || 0).toLocaleString("zh-CN", {
    maximumFractionDigits: 8,
  });

  return (
    <ModalBackdrop className="modal-backdrop holding-detail-backdrop" onClose={onClose}>
      <ModalPanel
        className="detail-modal holding-detail-dialog"
        eyebrow={`${holding.code} · ${holding.account_name}`}
        title={holding.name}
        onClose={onClose}
        footer={holding.can_edit !== false ? (
          <DialogActions className="holding-detail-actions">
            <DialogAction
              variant="primary"
              disabled={!holding.account_id}
              onClick={() => onTrade(holding, "buy")}
            >
              <CirclePlus size={16} /> 买入
            </DialogAction>
            <DialogAction
              disabled={!holding.account_id}
              onClick={() => onTrade(holding, "sell")}
            >
              <CircleMinus size={16} /> 卖出
            </DialogAction>
            <DialogAction onClick={() => onEdit(holding)}>
              <Pencil size={15} /> 编辑
            </DialogAction>
          </DialogActions>
        ) : null}
      >
        <div className="holding-detail-summary">
          <div>
            <span>当前市值</span>
            <strong>{formatMoney(holding.value)}</strong>
          </div>
          <div>
            <span>持仓盈亏</span>
            <strong className={profitClass}>
              {holding.profit >= 0 ? "+" : "-"}{formatMoney(Math.abs(holding.profit))}
            </strong>
            <small className={profitClass}>
              {holding.returnRate >= 0 ? "+" : ""}{holding.returnRate.toFixed(1)}%
            </small>
          </div>
        </div>
        <dl className="holding-detail-metrics">
          <div>
            <dt>持仓成本</dt>
            <dd>{holding.cost}</dd>
          </div>
          <div>
            <dt>当前价格</dt>
            <dd>{holding.price}</dd>
          </div>
          <div>
            <dt>持有数量</dt>
            <dd>{quantity}</dd>
          </div>
          <div>
            <dt>组合占比</dt>
            <dd>{holding.percent}%</dd>
          </div>
        </dl>
      </ModalPanel>
    </ModalBackdrop>
  );
}
