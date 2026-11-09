"""Read bounded Open XML package metadata without opening document contents."""
import json
import re
from xml.etree import ElementTree
import zipfile

from .engine import BoundedWriter, ProcessingError, detect, validate_zip


CONTENT_TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types'
RELATIONSHIPS = 'http://schemas.openxmlformats.org/package/2006/relationships'
OFFICE_RELATIONS = {
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
    'http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument',
}
DOCUMENTS = {
    'word/document.xml': ('docx', 'wordprocessingml.document'),
    'xl/workbook.xml': ('xlsx', 'spreadsheetml.sheet'),
    'ppt/presentation.xml': ('pptx', 'presentationml.presentation'),
}
PART_LIMIT = 256 * 1024


def read_package_xml(archive, name, namespace, root, ctx):
    ctx.check()
    try:
        info = archive.getinfo(name)
    except KeyError:
        raise ProcessingError('Unsupported Office document package') from None
    if (info.file_size > min(PART_LIMIT, ctx.limits['expanded'] - ctx.expanded) or
            info.file_size > max(1, info.compress_size) * ctx.limits['ratio']):
        raise ProcessingError('Document metadata limit reached')
    if info.flag_bits & 1 or info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
        raise ProcessingError('Unsupported Office metadata encoding')
    try:
        with archive.open(info) as stream:
            data = stream.read(PART_LIMIT + 1)
        if len(data) != info.file_size:
            raise ProcessingError('Invalid archive XML metadata size')
        ctx.expanded += len(data)
        xml = data.decode('utf-8-sig')
        if '\x00' in xml or '<!DOCTYPE' in xml or '<!ENTITY' in xml:
            raise ProcessingError('Unsafe XML declaration in Office metadata')
        tree = ElementTree.fromstring(xml)
    except (UnicodeError, ElementTree.ParseError) as error:
        raise ProcessingError('Invalid archive XML metadata') from error
    if tree.tag != f'{{{namespace}}}{root}':
        raise ProcessingError('Invalid archive XML metadata')
    return tree


def inspect_office(source, output, ctx):
    if detect(source) != 'zip':
        raise ProcessingError('Unsupported Office document package')
    validate_zip(source, ctx)
    with zipfile.ZipFile(source) as archive:
        members = archive.infolist()
        names = {item.filename for item in members}
        if len({name.casefold() for name in names}) != len(members) or any('\x00' in item.orig_filename for item in members):
            raise ProcessingError('Unsafe Office package names')
        relations = read_package_xml(archive, '_rels/.rels', RELATIONSHIPS, 'Relationships', ctx)
        office = [node for node in relations.findall(f'{{{RELATIONSHIPS}}}Relationship')
                  if node.get('Type') in OFFICE_RELATIONS]
        if len(office) != 1 or office[0].get('TargetMode', 'Internal') != 'Internal':
            raise ProcessingError('Unsupported Office document relationship')
        main = office[0].get('Target', '').removeprefix('/')
        if main not in DOCUMENTS or main not in names:
            raise ProcessingError('Unsupported Office document part')
        kind, content = DOCUMENTS[main]
        types = read_package_xml(archive, '[Content_Types].xml', CONTENT_TYPES, 'Types', ctx)
        declared = [node.get('ContentType') for node in types.findall(f'{{{CONTENT_TYPES}}}Override')
                    if node.get('PartName') == '/' + main]
        if declared != [f'application/vnd.openxmlformats-officedocument.{content}.main+xml']:
            raise ProcessingError('Unsupported Office document content type')
        report = {'format': kind, 'scope': 'package-metadata', 'packageEntries': len(members),
                  'mainPart': main, 'hasVbaProjectPart': any(name.lower().endswith('/vbaproject.bin') for name in names)}
        if kind == 'xlsx':
            report['worksheetParts'] = sum(bool(re.fullmatch(r'xl/worksheets/[^/]+\.xml', name)) for name in names)
        elif kind == 'pptx':
            report['slideParts'] = sum(bool(re.fullmatch(r'ppt/slides/[^/]+\.xml', name)) for name in names)
    ctx.report(state='verifying')
    with BoundedWriter(output, ctx) as stream:
        stream.write(json.dumps(report, ensure_ascii=True).encode('ascii'))
    return []
