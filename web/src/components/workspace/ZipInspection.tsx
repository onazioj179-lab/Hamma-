import { useEffect, useId, useState } from 'react';
import { inspectZip, type ZipMember } from '../../processing/zip-inspection';
import { formatFileSize } from '../../utils/fileHelpers';

const PAGE_SIZE = 50;

interface Props {
  file: File;
  disabled?: boolean;
  onExtract?: (indexes: number[]) => void;
}

export function ZipInspection(props: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <div className="zip-inspection">
    <button className="button secondary" type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      {open ? 'Close ZIP inspection' : 'Inspect ZIP'}
    </button>
    <div id={id} hidden={!open}>{open && <ZipMembers {...props} />}</div>
  </div>;
}

function ZipMembers({ file, disabled, onExtract }: Props) {
  const [members, setMembers] = useState<ZipMember[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(new Set<number>());
  useEffect(() => {
    let active = true;
    void inspectZip(file).then(result => {
      if (active) setMembers(result);
    }).catch(caught => {
      if (active) setError(caught instanceof Error ? caught.message : 'ZIP inspection failed');
    });
    return () => { active = false; };
  }, [file]);

  if (error) return <p role="alert">{error}</p>;
  if (!members) return <p role="status">Reading ZIP directory…</p>;
  const search = query.toLowerCase();
  const matches = members.map((member, index) => ({ member, index }))
    .filter(({ member }) => member.name.toLowerCase().includes(search));
  return <>
    <p className="footnote">Local directory listing. File contents and checksums are unchecked.</p>
    <label className="search-field"><input aria-label="Search ZIP entries" placeholder="Search ZIP entries" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
    <p role="status">{matches.length.toLocaleString()} of {members.length.toLocaleString()} entries</p>
    {onExtract && <button className="button secondary" type="button" disabled={disabled || !selected.size}
      onClick={() => onExtract([...selected].sort((a, b) => a - b))}>Extract selected entries ({selected.size})</button>}
    <ul className="zip-inspection-list">
      {matches.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(({ member, index }) => <li key={index}>
        {onExtract && <input type="checkbox" aria-label={`Select ZIP entry ${index + 1}: ${member.name.slice(0, 1024)}`}
          disabled={disabled || member.encrypted} checked={selected.has(index)} onChange={event => {
            const next = new Set(selected);
            if (event.target.checked) next.add(index); else next.delete(index);
            setSelected(next);
          }} />}
        <bdi>{member.name.length > 1024 ? member.name.slice(0, 1024) + '…' : member.name}</bdi>
        <small>{member.name.endsWith('/') ? 'Folder' : `${formatFileSize(member.size)} · ${formatFileSize(member.packedSize)} packed`}{member.encrypted ? ' · Encrypted' : ''}</small>
      </li>)}
    </ul>
    {matches.length > PAGE_SIZE && <div className="button-row">
      <button className="button secondary" type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous entries</button>
      <button className="button secondary" type="button" disabled={(page + 1) * PAGE_SIZE >= matches.length} onClick={() => setPage(page + 1)}>Next entries</button>
    </div>}
  </>;
}
