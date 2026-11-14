#!/usr/bin/python3
"""Export one workbook through the local UNO runtime inside the codec sandbox."""
import os
import sys


def export(profile, source, destination):
    os.environ['URE_BOOTSTRAP'] = 'vnd.sun.star.pathname:/usr/lib/libreoffice/program/fundamentalrc'
    os.environ['UserInstallation'] = profile

    import uno
    from com.sun.star.beans import PropertyValue
    from com.sun.star.document.MacroExecMode import NEVER_EXECUTE
    from com.sun.star.document.UpdateDocMode import NO_UPDATE

    def properties(**values):
        entries = []
        for name, value in values.items():
            entry = PropertyValue()
            entry.Name = name
            entry.Value = value
            entries.append(entry)
        return tuple(entries)

    context = uno.getComponentContext()
    desktop = context.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', context)
    workbook = desktop.loadComponentFromURL(
        source, '_blank', 0, properties(
            Hidden=True, ReadOnly=True, Silent=True, FilterName='Calc MS Excel 2007 XML',
            MacroExecutionMode=NEVER_EXECUTE, UpdateDocMode=NO_UPDATE,
        ),
    )
    if workbook is None:
        return 11
    try:
        workbook.storeToURL(destination, properties(FilterName='calc_pdf_Export'))
    finally:
        workbook.dispose()
    return 0


if __name__ == '__main__':
    sys.exit(export(*sys.argv[1:]))
