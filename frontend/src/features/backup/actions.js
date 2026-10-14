import { downloadFile, postJson } from "../../api";


export function downloadFamilyBackup(filename, requestOptions) {
  return downloadFile("/warehouse/backup", filename, requestOptions);
}


export function previewBackupRestore(backup) {
  return postJson("/warehouse/restore/preview", backup);
}


export function restoreFamilyBackup({
  backup,
  confirmReplace,
  expectedFingerprint,
}, requestOptions) {
  return postJson("/warehouse/restore", {
    backup,
    confirm_replace: confirmReplace,
    expected_fingerprint: expectedFingerprint,
  }, requestOptions);
}


export function downloadRecoveryBackup(filename) {
  return downloadFile(`/warehouse/recovery/${filename}`, filename);
}
