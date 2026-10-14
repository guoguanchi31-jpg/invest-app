import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ExternalLink,
  Maximize,
  Minus,
  Plus,
  RefreshCw,
  RotateCw,
  Smartphone,
  Tablet,
} from "lucide-react";
import { DEVICE_PRESETS, fitDeviceScale, orientedDimensions } from "./devices";

const SCALE_STEPS = [0.5, 0.75, 1];
const FRAME_INSET = 28;

function IconButton({ active = false, children, label, onClick }) {
  return (
    <button
      type="button"
      className={`simulator-icon-button${active ? " active" : ""}`}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Simulator() {
  const [deviceId, setDeviceId] = useState(DEVICE_PRESETS[0].id);
  const [orientation, setOrientation] = useState("portrait");
  const [scaleMode, setScaleMode] = useState("fit");
  const [frameVersion, setFrameVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const stageRef = useRef(null);

  const device = useMemo(
    () => DEVICE_PRESETS.find((item) => item.id === deviceId) || DEVICE_PRESETS[0],
    [deviceId],
  );
  const viewport = useMemo(
    () => orientedDimensions(device, orientation),
    [device, orientation],
  );
  const fitScale = useMemo(
    () => fitDeviceScale(stageSize, viewport),
    [stageSize, viewport],
  );
  const scale = scaleMode === "fit" ? fitScale : Number(scaleMode);
  const scalePercent = Math.round(scale * 100);

  const measureStage = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    setStageSize({ width: stage.clientWidth, height: stage.clientHeight });
  }, []);

  useEffect(() => {
    measureStage();
    window.addEventListener("resize", measureStage);

    if (typeof ResizeObserver === "undefined") {
      return () => window.removeEventListener("resize", measureStage);
    }

    const observer = new ResizeObserver(measureStage);
    observer.observe(stageRef.current);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measureStage);
    };
  }, [measureStage]);

  const refreshPreview = () => {
    setIsLoading(true);
    setFrameVersion((version) => version + 1);
  };

  const changeScale = (direction) => {
    const current = scaleMode === "fit" ? fitScale : Number(scaleMode);
    const nextSteps = [...SCALE_STEPS, fitScale]
      .filter((value, index, values) => values.indexOf(value) === index)
      .sort((a, b) => a - b);
    const currentIndex = nextSteps.findIndex((value) => value >= current - 0.01);
    const nextIndex = Math.max(
      0,
      Math.min(nextSteps.length - 1, currentIndex + direction),
    );
    setScaleMode(String(nextSteps[nextIndex]));
  };

  const frameStyle = {
    "--device-width": `${viewport.width}px`,
    "--device-height": `${viewport.height}px`,
    "--device-scale": scale,
    "--scaled-width": `${(viewport.width + FRAME_INSET) * scale}px`,
    "--scaled-height": `${(viewport.height + FRAME_INSET) * scale}px`,
  };

  return (
    <main className="simulator-shell">
      <header className="simulator-header">
        <div className="simulator-brand">
          <span className="simulator-brand-mark">
            <Smartphone size={18} strokeWidth={2.2} />
          </span>
          <div>
            <strong>Invest App 模拟器</strong>
            <small>本地预览</small>
          </div>
        </div>
        <div className="simulator-status">
          <span aria-hidden="true" />
          <strong>运行中</strong>
          <code>{window.location.host}</code>
        </div>
      </header>

      <div className="simulator-workbench">
        <aside className="simulator-controls" aria-label="模拟器控制台">
          <section className="simulator-control-section">
            <span className="simulator-control-label">设备</span>
            <label className="simulator-select">
              {device.kind === "tablet"
                ? <Tablet size={17} aria-hidden="true" />
                : <Smartphone size={17} aria-hidden="true" />}
              <select
                aria-label="预览设备"
                value={deviceId}
                onChange={(event) => setDeviceId(event.target.value)}
              >
                {DEVICE_PRESETS.map((item) => (
                  <option value={item.id} key={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
            <div className="simulator-viewport-readout">
              <span>视口</span>
              <strong>{viewport.width} × {viewport.height}</strong>
              <small>CSS px</small>
            </div>
          </section>

          <section className="simulator-control-section">
            <span className="simulator-control-label">方向</span>
            <div className="simulator-segmented">
              <button
                type="button"
                className={orientation === "portrait" ? "active" : ""}
                onClick={() => setOrientation("portrait")}
              >
                <Smartphone size={16} />
                竖屏
              </button>
              <button
                type="button"
                className={orientation === "landscape" ? "active" : ""}
                onClick={() => setOrientation("landscape")}
              >
                <RotateCw size={16} />
                横屏
              </button>
            </div>
          </section>

          <section className="simulator-control-section">
            <div className="simulator-control-heading">
              <span className="simulator-control-label">缩放</span>
              <strong>{scalePercent}%</strong>
            </div>
            <div className="simulator-scale-controls">
              <IconButton label="缩小" onClick={() => changeScale(-1)}>
                <Minus size={17} />
              </IconButton>
              <button
                type="button"
                className={`simulator-fit-button${scaleMode === "fit" ? " active" : ""}`}
                onClick={() => setScaleMode("fit")}
              >
                <Maximize size={16} />
                适应窗口
              </button>
              <IconButton label="放大" onClick={() => changeScale(1)}>
                <Plus size={17} />
              </IconButton>
            </div>
          </section>

          <section className="simulator-control-section simulator-actions">
            <button type="button" onClick={refreshPreview}>
              <RefreshCw size={17} />
              刷新 App
            </button>
            <a href="/" target="_blank" rel="noreferrer">
              <ExternalLink size={17} />
              独立打开
            </a>
          </section>

          <div className="simulator-runtime">
            <span>页面</span>
            <code>/</code>
            <span>渲染</span>
            <strong>{device.name}</strong>
          </div>
        </aside>

        <section className="simulator-stage" ref={stageRef} aria-label="App 预览区域">
          <div className="simulator-stage-grid" aria-hidden="true" />
          <div className="simulator-device-space" style={frameStyle}>
            <div
              className={`simulator-device simulator-device-${device.kind}`}
              data-testid="simulator-device"
            >
              <span className="simulator-speaker" aria-hidden="true" />
              <div className="simulator-screen">
                {isLoading ? (
                  <div className="simulator-loading" aria-live="polite">
                    <span />
                    正在载入
                  </div>
                ) : null}
                <iframe
                  key={frameVersion}
                  src="/?appPreview=1"
                  title={`${device.name} App 预览`}
                  onLoad={() => setIsLoading(false)}
                />
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default Simulator;
