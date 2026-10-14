import { patchJson, postJson } from "../../api";


export function updateFamily(payload) {
  return patchJson("/family", payload);
}


export function createFamilyMember(payload) {
  return postJson("/family/members", payload);
}


export function updateFamilyMember(memberId, payload) {
  return patchJson(`/family/members/${memberId}`, payload);
}


export function changePassword(payload) {
  return postJson("/auth/password", payload);
}
