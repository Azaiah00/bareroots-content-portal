export const copyText = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
};

/** Trigger a browser download for a cross-origin presigned URL. */
export const triggerDownload = (url: string) => {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  // `download` is ignored cross-origin; the presigned URL carries
  // Content-Disposition: attachment, which is what actually forces the save.
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 2000);
};
