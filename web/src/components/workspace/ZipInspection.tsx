import { useEffect, useId, useState } from 'react';
import { inspectZip, type ZipMember } from '../../processing/zip-inspection';
import { formatFileSize } from '../../utils/fileHelpers';

const PAGE_SIZE = 50;

export function ZipInspection({ file }: { file: File }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <div className="zip-inspection">
    <button className="button secondary" type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      {open ? 'Close ZIP inspection' : 'Inspect ZIP'}
    </button>
    <div id={id} hidden={!open}>{open && <ZipMembers file={file} />}</div>
  </div>;
}

function ZipMembers({ file }: { file: File }) {
  const [members, setMembers] = useState<ZipMember[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
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
  const matches = members.filter(member => member.name.toLowerCase().includes(search));
  return <>
    <p className="footnote">Local directory listing. File contents and checksums are unchecked.</p>
    <label className="search-field"><input aria-label="Search ZIP entries" placeholder="Search ZIP entries" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
    <p role="status">{matches.length.toLocaleString()} of {members.length.toLocaleString()} entries</p>
    <ul className="zip-inspection-list">
      {matches.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((member, index) => <li key={page * PAGE_SIZE + index}>
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
