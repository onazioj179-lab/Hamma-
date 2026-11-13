"""Small two-page PDF with different page geometry and painted content."""


def two_page_pdf():
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 200] /Resources <<>> /Contents 5 0 R >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources <<>> /Contents 6 0 R >>",
    ]
    for contents in (b"1 0 0 rg 0 0 100 200 re f\n", b"0 0 1 rg 0 0 200 100 re f\n"):
        objects.append(f"<< /Length {len(contents)} >>\nstream\n".encode() + contents + b"endstream")
    pdf = bytearray(b"%PDF-1.4\n")
    offsets = []
    for index, data in enumerate(objects, 1):
        offsets.append(len(pdf))
        pdf.extend(f"{index} 0 obj\n".encode() + data + b"\nendobj\n")
    xref = len(pdf)
    pdf.extend(f"xref\n0 {len(offsets) + 1}\n0000000000 65535 f \n".encode())
    for offset in offsets:
        pdf.extend(f"{offset:010d} 00000 n \n".encode())
    pdf.extend(f"trailer\n<< /Size {len(offsets) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return bytes(pdf)
