import { useEffect, useRef } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

let openModalCount = 0;
let previousBodyOverflow = "";
const modalLayers = [];
let nativeBackListener = null;
let nativeBackRequest = null;
let nativeBackVersion = 0;

function attachNativeBackListener() {
  if (
    !Capacitor.isNativePlatform()
    || nativeBackListener
    || nativeBackRequest
    || modalLayers.length === 0
  ) {
    return;
  }
  const version = nativeBackVersion;
  nativeBackRequest = CapacitorApp.addListener("backButton", () => {
    const topLayer = modalLayers.at(-1);
    if (topLayer && !topLayer.closeDisabled) topLayer.onClose();
  }).then((listener) => {
    nativeBackRequest = null;
    if (version !== nativeBackVersion || modalLayers.length === 0) {
      void listener.remove();
      attachNativeBackListener();
      return;
    }
    nativeBackListener = listener;
  }).catch(() => {
    nativeBackRequest = null;
  });
}

function detachNativeBackListener() {
  if (modalLayers.length > 0) return;
  nativeBackVersion += 1;
  if (nativeBackListener) void nativeBackListener.remove();
  nativeBackListener = null;
}

function lockBodyScroll() {
  if (openModalCount === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  openModalCount += 1;
}

function unlockBodyScroll() {
  openModalCount = Math.max(openModalCount - 1, 0);
  if (openModalCount === 0) document.body.style.overflow = previousBodyOverflow;
}

export default function ModalBackdrop({
  children,
  className = "modal-backdrop",
  closeDisabled = false,
  onClose,
}) {
  const layerRef = useRef({
    closeDisabled,
    key: Symbol("modal-layer"),
    onClose,
  });
  layerRef.current.closeDisabled = closeDisabled;
  layerRef.current.onClose = onClose;

  useEffect(() => {
    const layer = layerRef.current;
    modalLayers.push(layer);
    lockBodyScroll();
    attachNativeBackListener();

    return () => {
      const index = modalLayers.lastIndexOf(layer);
      if (index >= 0) modalLayers.splice(index, 1);
      detachNativeBackListener();
      unlockBodyScroll();
    };
  }, []);

  useEffect(() => {
    if (closeDisabled) return undefined;
    const closeOnEscape = (event) => {
      if (
        event.key === "Escape"
        && modalLayers.at(-1) === layerRef.current
      ) {
        event.preventDefault();
        layerRef.current.onClose();
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [closeDisabled, onClose]);

  return (
    <div
      className={className}
      data-modal-backdrop
      role="presentation"
      onClick={(event) => {
        if (!closeDisabled && event.target === event.currentTarget) onClose();
      }}
    >
      {children}
    </div>
  );
}
