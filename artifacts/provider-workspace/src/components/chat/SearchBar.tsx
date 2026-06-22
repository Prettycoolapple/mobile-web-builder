import { useEffect, useRef, useState } from "react";

interface SearchBarProps {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}

/** Central ChatGPT/Claude-style composer: auto-growing textarea + send. */
export function SearchBar({ onSubmit, disabled, placeholder, autoFocus }: SearchBarProps) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value]);

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    onSubmit(text);
    setValue("");
  };

  return (
    <div className="ws-searchbar">
      <textarea
        ref={ref}
        rows={1}
        value={value}
        placeholder={placeholder ?? "Search listings, screen for subdivision, or analyse an address…"}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button className="ws-send" onClick={submit} disabled={disabled || !value.trim()} aria-label="Send">
        ↑
      </button>
    </div>
  );
}
