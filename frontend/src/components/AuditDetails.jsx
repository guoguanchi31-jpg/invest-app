import { auditFieldChanges } from "../features/audit/presentation";


export default function AuditDetails({
  event,
  accounts = [],
  categories = [],
  members = [],
}) {
  const { after, before, changes, historical } = auditFieldChanges(event, {
    accounts, categories, members,
  });

  return (
    <details className="audit-details">
      <summary aria-label={`查看变更详情：${event.summary}`}>查看变更详情</summary>
      {changes.length ? <table aria-label="操作变更字段">
        <thead><tr><th scope="col">字段</th><th scope="col">修改前</th><th scope="col">修改后</th></tr></thead>
        <tbody>{changes.map((change) => <tr key={change.key}>
          <th scope="row">{change.label}</th><td>{change.before}</td><td>{change.after}</td>
        </tr>)}</tbody>
      </table> : <p>{
        historical
          ? "此历史记录使用旧版载荷，原始内容已保留但不能安全关联当前实体。"
          : before || after
            ? "本次操作没有可展示的字段变更。"
            : "此历史记录未保存修改前后值。"
      }</p>}
    </details>
  );
}
