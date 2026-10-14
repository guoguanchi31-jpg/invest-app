import { useState } from "react";
import { Check, History, KeyRound, Pencil, Save, UserPlus, Users, X } from "lucide-react";
import { AUTH_TOKEN_KEY } from "../api";
import {
  changePassword as changePasswordAction,
  createFamilyMember,
  updateFamily,
  updateFamilyMember,
} from "../features/family/actions";
import { refreshAfterCommit } from "../features/shared/useSubmission";
import ModalBackdrop from "./ModalBackdrop";
import ModalPanel from "./ModalPanel";
import AuditDetails from "./AuditDetails";

const EMPTY_MEMBER = {
  display_name: "",
  username: "",
  password: "",
  role: "member",
};

function canManageMemberProfile(family, member) {
  return family.role === "owner" || member.role === "member";
}

function canManageMemberAccess(family, member) {
  return family.role === "owner" && !member.is_current && member.role !== "owner";
}

export default function FamilyDialog({ family, onClose, onChanged }) {
  const [familyName, setFamilyName] = useState(family.name);
  const [memberForm, setMemberForm] = useState(EMPTY_MEMBER);
  const [editingMemberId, setEditingMemberId] = useState(null);
  const [memberDraft, setMemberDraft] = useState(null);
  const [passwordForm, setPasswordForm] = useState({ current_password: "", new_password: "" });
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const run = async (key, action, onCommitted) => {
    setBusy(key);
    setMessage("");
    let result;
    try {
      result = await action();
    } catch (error) {
      setMessage(error.message);
      setBusy("");
      return null;
    }
    setMessage(result.message || "已保存");
    try {
      onCommitted?.(result);
    } catch {
      setMessage("已保存，界面更新失败，请重新加载核对结果。");
    }
    try {
      await refreshAfterCommit(onChanged, setMessage);
    } finally {
      setBusy("");
    }
    return result;
  };

  const saveFamilyName = () => run("family", () => updateFamily({
    name: familyName.trim(),
  }));

  const createMember = async () => {
    if (!memberForm.display_name.trim() || !memberForm.username.trim() || memberForm.password.length < 8) {
      setMessage("请填写成员名称、登录账号和至少 8 位的初始密码");
      return;
    }
    await run(
      "member",
      () => createFamilyMember({
        ...memberForm,
        role: family.role === "owner" ? memberForm.role : "member",
      }),
      () => setMemberForm(EMPTY_MEMBER),
    );
  };

  const startEditingMember = (member) => {
    setEditingMemberId(member.id);
    setMemberDraft({
      display_name: member.display_name,
      username: member.username || "",
      password: "",
      role: member.role === "owner" ? "owner" : member.role,
      login_enabled: member.login_enabled,
    });
    setMessage("");
  };

  const saveMember = async () => {
    if (!memberDraft?.display_name.trim()) {
      setMessage("成员名称不能为空");
      return;
    }
    const member = family.members.find((item) => item.id === editingMemberId);
    const payload = {
      display_name: memberDraft.display_name.trim(),
    };
    if (member && canManageMemberAccess(family, member)) {
      Object.assign(payload, {
        username: memberDraft.username.trim() || null,
        password: memberDraft.password || null,
        role: memberDraft.role,
        login_enabled: memberDraft.login_enabled,
      });
    }
    await run(
      `member-${editingMemberId}`,
      () => updateFamilyMember(editingMemberId, payload),
      () => {
        setEditingMemberId(null);
        setMemberDraft(null);
      },
    );
  };

  const changePassword = async () => {
    if (!passwordForm.current_password || passwordForm.new_password.length < 8) {
      setMessage("新密码至少需要 8 位");
      return;
    }
    await run(
      "password",
      () => changePasswordAction(passwordForm),
      (result) => {
        localStorage.setItem(AUTH_TOKEN_KEY, result.access_token);
        setPasswordForm({ current_password: "", new_password: "" });
      },
    );
  };

  return (
    <ModalBackdrop onClose={onClose} closeDisabled={Boolean(busy)}>
      <ModalPanel
        className="family-dialog"
        closeDisabled={Boolean(busy)}
        eyebrow="家庭空间"
        onClose={onClose}
        title="家庭与成员"
        titleId="family-title"
      >
        <div className="family-settings-section">
          <div className="family-section-heading">
            <Users size={18} />
            <div><strong>{family.name}</strong><span>{family.members.length} 位成员</span></div>
          </div>
          {family.can_manage && (
            <div className="family-inline-form">
              <label>
                <span>家庭名称</span>
                <input value={familyName} maxLength={60} onChange={(event) => setFamilyName(event.target.value)} />
              </label>
              <button type="button" className="filter-button" disabled={busy === "family" || !familyName.trim() || familyName.trim() === family.name} onClick={saveFamilyName}>
                <Check size={15} /> 保存
              </button>
            </div>
          )}
          <div className="family-member-list">
            {family.members.map((member) => (
              <div className="family-member-entry" key={member.id}>
                <div className="family-member-row">
                  <span className="member-avatar">{Array.from(member.display_name)[0] || "我"}</span>
                  <div>
                    <strong>{member.display_name}{member.is_current ? " · 我" : ""}</strong>
                    <span>{member.login_enabled ? `账号 ${member.username}` : member.user_id ? `账号 ${member.username} · 登录已停用` : "尚未开通独立登录"}</span>
                  </div>
                  <small>{member.role === "owner" ? "创建者" : member.role === "admin" ? "管理员" : "成员"} · {member.account_count} 个账户</small>
                  {family.can_manage && canManageMemberProfile(family, member) && (
                    <button type="button" className="row-icon-button" aria-label={`管理${member.display_name}`} title="管理成员" onClick={() => startEditingMember(member)}>
                      <Pencil size={15} />
                    </button>
                  )}
                </div>
                {editingMemberId === member.id && memberDraft && (
                  <div className="family-member-editor">
                    <label className="form-field">
                      <span>成员名称</span>
                      <input value={memberDraft.display_name} onChange={(event) => setMemberDraft((value) => ({ ...value, display_name: event.target.value }))} />
                    </label>
                    {canManageMemberAccess(family, member) && (
                      <>
                        <label className="form-field">
                          <span>登录账号</span>
                          <input autoComplete="off" value={memberDraft.username} onChange={(event) => setMemberDraft((value) => ({ ...value, username: event.target.value }))} />
                        </label>
                        <label className="form-field">
                          <span>{member.user_id ? "重置密码（可选）" : "初始密码"}</span>
                          <input type="password" autoComplete="new-password" placeholder="至少 8 位" value={memberDraft.password} onChange={(event) => setMemberDraft((value) => ({ ...value, password: event.target.value }))} />
                        </label>
                        <label className="form-field">
                          <span>家庭角色</span>
                          <select value={memberDraft.role} onChange={(event) => setMemberDraft((value) => ({ ...value, role: event.target.value }))}>
                            <option value="member">成员</option>
                            <option value="admin">管理员</option>
                          </select>
                        </label>
                        <label className="family-login-toggle">
                          <input
                            type="checkbox"
                            checked={memberDraft.login_enabled}
                            onChange={(event) => setMemberDraft((value) => ({ ...value, login_enabled: event.target.checked }))}
                          />
                          <span>{memberDraft.login_enabled ? "允许登录" : "停用登录并保留历史"}</span>
                        </label>
                      </>
                    )}
                    <div className="family-editor-actions">
                      <button type="button" className="filter-button" onClick={() => { setEditingMemberId(null); setMemberDraft(null); }}>
                        <X size={15} /> 取消
                      </button>
                      <button type="button" className="filter-button primary" disabled={busy === `member-${member.id}`} onClick={saveMember}>
                        <Save size={15} /> {busy === `member-${member.id}` ? "保存中" : "保存成员"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {family.can_manage && (
          <div className="family-settings-section">
            <div className="family-section-heading">
              <UserPlus size={18} />
              <div><strong>添加成员账号</strong><span>同名待开通成员会自动绑定原有账户</span></div>
            </div>
            <div className="quick-add family-member-form">
              <label className="form-field">
                <span>成员名称</span>
                <input autoComplete="off" placeholder="例如：大宝" value={memberForm.display_name} onChange={(event) => setMemberForm((value) => ({ ...value, display_name: event.target.value }))} />
              </label>
              <label className="form-field">
                <span>登录账号</span>
                <input autoComplete="username" placeholder="例如：dabao" value={memberForm.username} onChange={(event) => setMemberForm((value) => ({ ...value, username: event.target.value }))} />
              </label>
              <label className="form-field">
                <span>初始密码</span>
                <input type="password" autoComplete="new-password" placeholder="至少 8 位" value={memberForm.password} onChange={(event) => setMemberForm((value) => ({ ...value, password: event.target.value }))} />
              </label>
              {family.role === "owner" && (
                <label className="form-field">
                  <span>家庭角色</span>
                  <select value={memberForm.role} onChange={(event) => setMemberForm((value) => ({ ...value, role: event.target.value }))}>
                    <option value="member">成员</option>
                    <option value="admin">管理员</option>
                  </select>
                </label>
              )}
            </div>
            <button type="button" className="filter-button primary" disabled={busy === "member"} onClick={createMember}>
              <UserPlus size={15} /> {busy === "member" ? "创建中" : "创建成员账号"}
            </button>
          </div>
        )}

        <div className="family-settings-section">
          <div className="family-section-heading">
            <History size={18} />
            <div><strong>最近操作</strong><span>记录实际操作成员与更正原因</span></div>
          </div>
          <div className="family-activity-list">
            {(family.recent_activity || []).map((item) => (
              <div className="family-activity-row" key={item.id}>
                <div>
                  <strong>{item.summary}</strong>
                  <span>{item.actor_name} · {new Date(item.created_at).toLocaleString("zh-CN")}</span>
                </div>
                {item.reason && <small>{item.reason}</small>}
                <AuditDetails event={item} members={family.members} />
              </div>
            ))}
            {!family.recent_activity?.length && <div className="empty-state">暂无操作记录。</div>}
          </div>
        </div>

        <div className="family-settings-section">
          <div className="family-section-heading">
            <KeyRound size={18} />
            <div><strong>修改我的密码</strong><span>更新后其他设备需要重新登录</span></div>
          </div>
          <div className="quick-add family-password-form">
            <label className="form-field">
              <span>当前密码</span>
              <input type="password" autoComplete="current-password" value={passwordForm.current_password} onChange={(event) => setPasswordForm((value) => ({ ...value, current_password: event.target.value }))} />
            </label>
            <label className="form-field">
              <span>新密码</span>
              <input type="password" autoComplete="new-password" placeholder="至少 8 位" value={passwordForm.new_password} onChange={(event) => setPasswordForm((value) => ({ ...value, new_password: event.target.value }))} />
            </label>
          </div>
          <button type="button" className="filter-button" disabled={busy === "password"} onClick={changePassword}>
            <KeyRound size={15} /> {busy === "password" ? "更新中" : "更新密码"}
          </button>
        </div>

        {message && <p className="family-dialog-message" role="status">{message}</p>}
      </ModalPanel>
    </ModalBackdrop>
  );
}
