import { ArrowRight, Undo2 } from "lucide-react";
import DialogActions, { DialogAction } from "../../components/DialogActions";
import ModalBackdrop from "../../components/ModalBackdrop";
import ModalPanel from "../../components/ModalPanel";
import { formatCurrencyAmount } from "../../shared/money";
import { buildTransferDetail } from "./presentation";

function accountLabel(side) {
  return `${side.owner} · ${side.name}`;
}

export default function TransferDetailDialog({
  accounts,
  canReverse,
  formatDateLabel,
  formatMoney,
  item,
  onClose,
  onReverse,
}) {
  const detail = buildTransferDetail(item, accounts);
  const isVoided = Boolean(item.voided_at);
  return (
    <ModalBackdrop onClose={onClose}>
      <ModalPanel
        className="transfer-detail-dialog"
        eyebrow={formatDateLabel(item.occurred_at)}
        footer={(
          <DialogActions>
            <DialogAction onClick={onClose}>关闭</DialogAction>
            {canReverse ? (
              <DialogAction variant="danger" onClick={() => onReverse(item)}>
                <Undo2 size={16} aria-hidden="true" />
                撤销转账
              </DialogAction>
            ) : null}
          </DialogActions>
        )}
        onClose={onClose}
        title="转账详情"
      >
        <div className={`transfer-detail-status${isVoided ? " is-voided" : ""}`}>
          <strong>{isVoided ? "转账已撤销" : "转账已完成"}</strong>
          <span>
            {isVoided
              ? "原记录保留用于账务追溯，不再影响账户余额。"
              : "资金已在两个账户之间完成划转。"}
          </span>
        </div>

        <div className="transfer-detail-route">
          <section aria-label="转出账户">
            <span>转出</span>
            <strong>{accountLabel(detail.from)}</strong>
            <b>{formatCurrencyAmount(detail.from.amount, detail.from.currency)}</b>
          </section>
          <ArrowRight aria-hidden="true" />
          <section aria-label="转入账户">
            <span>转入</span>
            <strong>{accountLabel(detail.to)}</strong>
            <b>{formatCurrencyAmount(detail.to.amount, detail.to.currency)}</b>
          </section>
        </div>

        <dl className="transfer-detail-facts">
          <div>
            <dt>发生日期</dt>
            <dd>{formatDateLabel(item.occurred_at)}</dd>
          </div>
          {detail.isCrossCurrency ? (
            <div>
              <dt>本位币金额</dt>
              <dd>{formatMoney(detail.baseAmount)}</dd>
            </div>
          ) : null}
          <div className="wide">
            <dt>统计口径</dt>
            <dd>仅移动账户间资金，不计入收入、支出与结余</dd>
          </div>
          <div className="wide">
            <dt>备注</dt>
            <dd>{item.note || "未填写"}</dd>
          </div>
          {isVoided ? (
            <div className="wide">
              <dt>撤销原因</dt>
              <dd>{item.void_reason || "未填写"}</dd>
            </div>
          ) : null}
        </dl>

        {!isVoided && !canReverse ? (
          <p className="workflow-note">
            当前账户已归档或当前身份无权操作，本次转账仅可查看。
          </p>
        ) : null}
      </ModalPanel>
    </ModalBackdrop>
  );
}
