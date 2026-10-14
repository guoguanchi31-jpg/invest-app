import { Download } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import DialogActions, { DialogAction } from "./DialogActions";
import ModalBackdrop from "./ModalBackdrop";
import ModalPanel from "./ModalPanel";

const ANDROID_DOWNLOAD_PATH = "/downloads/Invest-Android.apk";
const ANDROID_DOWNLOAD_URL = import.meta.env.VITE_ANDROID_DOWNLOAD_URL
  || `https://ggcmoney.work${ANDROID_DOWNLOAD_PATH}`;

export default function AppDownloadDialog({ onClose }) {
  return (
    <ModalBackdrop onClose={onClose}>
      <ModalPanel
        className="app-download-dialog"
        eyebrow="Android App"
        footer={(
          <DialogActions>
            <DialogAction onClick={onClose}>完成</DialogAction>
            <a
              className="dialog-action-button primary"
              href={ANDROID_DOWNLOAD_PATH}
              download
            >
              <Download size={17} aria-hidden="true" />
              直接下载 APK
            </a>
          </DialogActions>
        )}
        onClose={onClose}
        title="扫码下载 Invest App"
      >
        <div className="app-download-qr-content">
          <div
            className="app-download-qr"
            role="img"
            aria-label="Invest Android App 下载二维码"
            data-download-url={ANDROID_DOWNLOAD_URL}
          >
            <QRCodeSVG
              aria-hidden="true"
              bgColor="#ffffff"
              fgColor="#14231d"
              level="M"
              marginSize={1}
              size={224}
              value={ANDROID_DOWNLOAD_URL}
            />
          </div>
          <div className="app-download-qr-copy">
            <strong>手机扫码下载</strong>
            <span>适用于 Android 设备</span>
            <small>ggcmoney.work</small>
          </div>
        </div>
      </ModalPanel>
    </ModalBackdrop>
  );
}
