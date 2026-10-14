export const ICP_RECORD_NUMBER = "京ICP备2026067668号";
export const ICP_RECORD_URL = "https://beian.miit.gov.cn/";

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <a href={ICP_RECORD_URL} target="_blank" rel="noreferrer">
        {ICP_RECORD_NUMBER}
      </a>
    </footer>
  );
}
