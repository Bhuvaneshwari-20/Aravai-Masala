import React, { useCallback, useEffect, useRef, useState } from 'react';
import api, { errMsg } from '../api';
import { useAuth } from '../AuthContext';
import { useUi } from '../ui';
import SelectField from './SelectField';

const byValue = (a, b) => Number(a.mesh_size) - Number(b.mesh_size);

// Mesh size dropdown for Grinding (Start / Stop popups, any grinding form).
//   - lists the Mesh Size master (mesh_master)
//   - "Add new mesh size (mm)" at the bottom of the popup: the size is saved in the master at once and selected
// onChange(meshId, meshSize)  -> store whichever your form sends (id and/or the size text, e.g. "20")
// Inside a popup (ModalShell) the Auth/Ui context is NOT available, so pass these from the screen:
//   canAdd  = can('grinding','create') || can('mesh','create')
//   onAdded = (mesh) => toast(...)
export default function MeshSelectField({ value, onChange, error, disabled, label = 'Mesh size (mm) *', canAdd, onAdded }) {
  const auth = useAuth(); // null inside a popup
  const { toast } = useUi();
  const allowed = canAdd !== undefined ? !!canAdd : !!auth && (auth.can('grinding', 'create') || auth.can('mesh', 'create'));
  const [list, setList] = useState([]);
  const ref = useRef([]); // always the latest list, also right after a new size was added

  const load = useCallback(async () => {
    try {
      const r = await api.get('/grinding/meshes');
      const d = r.data?.data ?? r.data;
      ref.current = (Array.isArray(d) ? d : d.items || []).slice().sort(byValue);
      setList(ref.current);
    } catch (e) { /* the dropdown simply stays empty */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async (name) => {
    try {
      const r = await api.post('/grinding/meshes', { mesh_size: name });
      const m = r.data?.data ?? r.data;
      ref.current = [...ref.current.filter((x) => x.id !== m.id), m].sort(byValue);
      setList(ref.current);
      if (onAdded) onAdded(m); else toast(`Mesh ${m.mesh_size} mm added`);
      return { value: m.id, label: `${m.mesh_size} mm` };
    } catch (e) { throw new Error(errMsg(e)); }
  };

  const pick = (id) => {
    const m = ref.current.find((x) => x.id === id);
    onChange(id, m ? String(m.mesh_size) : '');
  };

  return (
    <SelectField label={label} value={value} disabled={disabled} error={error}
      options={list.map((m) => ({ value: m.id, label: `${m.mesh_size} mm` }))} onChange={pick}
      onCreate={allowed ? add : undefined} createLabel="Add new mesh size (mm)" />
  );
}