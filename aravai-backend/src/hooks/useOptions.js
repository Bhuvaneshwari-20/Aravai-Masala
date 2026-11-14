import { useEffect, useState } from 'react';
import api from '../api';

// Loads up to 100 rows of a list endpoint as dropdown options: [{ value, label, raw }]
export default function useOptions(path, params, toOption, enabled = true) {
  const [options, setOptions] = useState([]);
  const key = JSON.stringify(params || {});
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    (async () => {
      try {
        const r = await api.get(path, { params: { ...params, limit: 100 } });
        const d = r.data.data;
        if (live) setOptions((Array.isArray(d) ? d : d.items).map(toOption));
      } catch (e) { if (live) setOptions([]); }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key, enabled]);
  return options;
}
