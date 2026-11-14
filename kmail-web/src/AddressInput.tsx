import { useEffect, useId, useState } from "react";
import { Input } from "@fluentui/react-components";
import { api } from "./api";

/** Comma-separated address field that suggests people from the user's contacts as they type the last address. */
export function AddressInput({ value, onChange, after }: { value: string; onChange: (v: string) => void; after?: React.ReactElement }) {
  const id = useId();
  const [options, setOptions] = useState<{ name: string; email: string }[]>([]);
  const cut = Math.max(value.lastIndexOf(","), value.lastIndexOf(";")) + 1;
  const prefix = value.slice(0, cut);
  const token = value.slice(cut).trim();

  useEffect(() => {
    if (token.length < 2 || token.includes("@") && token.includes(".")) { setOptions([]); return; }
    const t = setTimeout(() => { api.suggest(token).then(setOptions).catch(() => setOptions([])); }, 200);
    return () => clearTimeout(t);
  }, [token]);

  return (
    <>
      <Input value={value} onChange={(_, d) => onChange(d.value)} input={{ list: id, autoComplete: "off" }} contentAfter={after} />
      <datalist id={id}>
        {options.map((o) => <option key={o.email} value={`${prefix}${prefix && !prefix.endsWith(" ") ? " " : ""}${o.email}, `} label={o.name} />)}
      </datalist>
    </>
  );
}
