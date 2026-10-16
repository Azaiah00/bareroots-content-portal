import { useEffect, useState, type FormEvent } from "react";
import { usePortal } from "@/lib/store";
import { Button, GoldMotes } from "@/components/ui";
import { useMounted } from "@/lib/motion";
import { ApiError } from "@/lib/api";

/**
 * The front door. One PIN decides who you are (client or studio); a name chip
 * says which of you is here. Both are remembered on the device.
 */

const NAME_KEY = "br-portal-name";

const CLIENT_NAMES = ["Iisha", "Sabrina"];
const STUDIO_NAMES = ["Fred", "Azaiah"];

export const Gate = () => {
  const { signIn } = usePortal();
  const mounted = useMounted();
  const [pin, setPin] = useState("");
  const [name, setName] = useState<string>(() => {
    try {
      return localStorage.getItem(NAME_KEY) || "";
    } catch {
      return "";
    }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"pin" | "name">("pin");
  const [other, setOther] = useState("");

  useEffect(() => {
    try {
      if (name) localStorage.setItem(NAME_KEY, name);
    } catch {
      /* ignore */
    }
  }, [name]);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (step === "pin") {
      if (pin.replace(/\D/g, "").length < 4) {
        setError("Your PIN has at least four digits.");
        return;
      }
      setError(null);
      setStep("name");
      return;
    }
    const who = other.trim() || name;
    if (!who) {
      setError("Tap your name so we know who's here.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signIn(pin, who);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't sign in. Try again.");
      if (err instanceof ApiError && (err.code === "bad_pin" || err.code === "locked")) setStep("pin");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gate">
      <GoldMotes />
      <form className="gate-card" onSubmit={submit} data-reveal={mounted ? "in" : ""}>
        <div className="seal">
          <img src="/img/logo-br.png" alt="Bare Roots" width={110} height={110} decoding="async" />
        </div>
        <div>
          <span className="eyebrow" style={{ justifyContent: "center" }}>
            Bare Roots × Couture House
          </span>
          <h1 style={{ marginTop: "0.75rem" }}>
            The content <span className="accent">house.</span>
          </h1>
          <p className="muted" style={{ marginTop: "0.75rem" }}>
            {step === "pin" ? "Drop off footage, pick up finished posts, share ideas. Enter your PIN to come in." : "Who's here today?"}
          </p>
        </div>

        {step === "pin" ? (
          <div className="pin-row">
            <input
              className="pin-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={8}
              placeholder="••••"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              aria-label="PIN"
              autoFocus
            />
          </div>
        ) : (
          <div className="stack">
            <div className="name-chips">
              {[...CLIENT_NAMES, ...STUDIO_NAMES].map((n) => (
                <button
                  type="button"
                  key={n}
                  className="name-chip"
                  aria-pressed={name === n && !other}
                  onClick={() => {
                    setName(n);
                    setOther("");
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
            <input className="input" placeholder="Someone else? Type a name" value={other} onChange={(e) => setOther(e.target.value)} aria-label="Other name" style={{ textAlign: "center" }} />
          </div>
        )}

        {error ? (
          <p className="small" role="alert" style={{ color: "var(--alert-lift)" }}>
            {error}
          </p>
        ) : null}

        <div className="stack">
          <Button type="submit" variant="gold" block busy={busy} icon={step === "pin" ? "arrow-right" : "crown"}>
            {step === "pin" ? "Continue" : "Come in"}
          </Button>
          {step === "name" ? (
            <Button type="button" size="sm" onClick={() => setStep("pin")}>
              Back
            </Button>
          ) : null}
        </div>
        <p className="xs muted">Rooted in culture. Crowned in gold.</p>
      </form>
    </div>
  );
};
