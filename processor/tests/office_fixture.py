"""Minimal Office Open XML fixtures with text visible on the exported page."""

from io import BytesIO
from zipfile import ZipFile


OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
PACKAGE = 'http://schemas.openxmlformats.org/package/2006'
WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
SLIDES = 'http://schemas.openxmlformats.org/presentationml/2006/main'
DRAW = 'http://schemas.openxmlformats.org/drawingml/2006/main'


def relationships(*links):
    return f'<Relationships xmlns="{PACKAGE}/relationships">' + ''.join(
        f'<Relationship Id="rId{index}" Type="{OFFICE}/{kind}" Target="{target}"/>'
        for index, (kind, target) in enumerate(links, 1)
    ) + '</Relationships>'


def office_fixture(kind, extra=None):
    text = 'HAMMA verified export'
    if kind == 'docx':
        root = 'word/document.xml'
        parts = {root: ('wordprocessingml.document.main', f'''<w:document xmlns:w="{WORD}"><w:body>
          <w:p><w:r><w:t>{text}</w:t></w:r></w:p>
          <w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>
          </w:body></w:document>''')}
        related = {}
    elif kind == 'pptx':
        root = 'ppt/presentation.xml'
        parts = {
            root: ('presentationml.presentation.main', f'''<p:presentation xmlns:p="{SLIDES}" xmlns:r="{OFFICE}">
              <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
              <p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/>
              </p:presentation>'''),
            'ppt/slides/slide1.xml': ('presentationml.slide', f'''<p:sld xmlns:p="{SLIDES}" xmlns:a="{DRAW}">
              <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
              <p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Text"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
              <p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="7315200" cy="914400"/></a:xfrm>
              <a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
              <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="2400">
              <a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:latin typeface="Liberation Sans"/>
              </a:rPr><a:t>{text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'''),
        }
        related = {'ppt/_rels/presentation.xml.rels': relationships(('slide', 'slides/slide1.xml'))}
    else:
        raise ValueError(kind)

    output = BytesIO()
    with ZipFile(output, 'w') as archive:
        types = ''.join(f'<Override PartName="/{name}" '
                        f'ContentType="application/vnd.openxmlformats-officedocument.{content}+xml"/>'
                        for name, (content, _) in parts.items())
        archive.writestr('[Content_Types].xml', f'<Types xmlns="{PACKAGE}/content-types">'
                         '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                         '<Default Extension="xml" ContentType="application/xml"/>'
                         + types + '</Types>')
        archive.writestr('_rels/.rels', relationships(('officeDocument', root)))
        for name, (_, xml) in parts.items():
            archive.writestr(name, xml)
        for name, data in {**related, **(extra or {})}.items():
            archive.writestr(name, data)
    return output.getvalue()
