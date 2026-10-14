import ModalBackdrop from "../../components/ModalBackdrop";
import ModalPanel from "../../components/ModalPanel";


export default function GoalRecordsDialog({
  closeGoalRecords,
  formatDateLabel,
  formatMoney,
  goalRecords,
}) {
  if (!goalRecords) return null;
  return (
    <ModalBackdrop onClose={closeGoalRecords}>
      <ModalPanel
        className="detail-modal"
        eyebrow="存取记录"
        onClose={closeGoalRecords}
        title={goalRecords.goal.name}
      >
        <div className="detail-section">
          {goalRecords.records.map((record) => (
            <div className="detail-list-row" key={record.id}>
              <div>
                <strong>{record.amount >= 0 ? "存入" : "取出"}</strong>
                <span>
                  {formatDateLabel(record.recorded_at)}
                  {record.note ? ` · ${record.note}` : ""}
                </span>
              </div>
              <b className={record.amount >= 0 ? "positive" : "negative"}>
                {record.amount >= 0 ? "+" : "-"}
                {formatMoney(Math.abs(record.amount))}
              </b>
            </div>
          ))}
          {!goalRecords.records.length ? (
            <div className="empty-state">还没有存取记录。</div>
          ) : null}
        </div>
      </ModalPanel>
    </ModalBackdrop>
  );
}
