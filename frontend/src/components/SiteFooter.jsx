import { FileCheck2 } from "lucide-react";

export const ICP_RECORD_NUMBER = "京ICP备2026067668号";
export const ICP_RECORD_URL = "https://beian.miit.gov.cn/";
export const PUBLIC_SECURITY_RECORD_NUMBER = "京公网安备11011302008442号";
export const PUBLIC_SECURITY_RECORD_URL =
  "https://beian.mps.gov.cn/#/query/webSearch?code=11011302008442";
export const PUBLIC_SECURITY_RECORD_ICON = "/beian-police.png";

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-records">
        <a
          className="site-footer-icp-record"
          href={ICP_RECORD_URL}
          target="_blank"
          rel="noreferrer"
        >
          <FileCheck2
            className="site-footer-record-icon"
            aria-hidden="true"
            strokeWidth={1.8}
          />
          {ICP_RECORD_NUMBER}
        </a>
        <a
          className="site-footer-police-record"
          href={PUBLIC_SECURITY_RECORD_URL}
          target="_blank"
          rel="noreferrer"
        >
          <img
            className="site-footer-record-icon"
            src={PUBLIC_SECURITY_RECORD_ICON}
            alt=""
            aria-hidden="true"
            width="20"
            height="20"
          />
          {PUBLIC_SECURITY_RECORD_NUMBER}
        </a>
      </div>
    </footer>
  );
}
