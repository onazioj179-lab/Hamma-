/* Single-document LibreOfficeKit export, launched inside the codec sandbox. */
#include <LibreOfficeKit/LibreOfficeKitInit.h>
#include <stdio.h>

int main(int argc, char **argv)
{
    if (argc != 5) {
        return 2;
    }
    LibreOfficeKit *office = lok_init_2(argv[1], argv[2]);
    if (!office) {
        fputs("LibreOfficeKit could not initialize\n", stderr);
        return 1;
    }
    LibreOfficeKitDocument *document = office->pClass->documentLoadWithOptions(
        office, argv[3], "EnableMacrosExecution=false,MacroSecurityLevel=3");
    int exported = 0;
    if (document) {
        exported = document->pClass->saveAs(document, argv[4], "pdf", NULL);
        document->pClass->destroy(document);
    }
    if (!exported) {
        char *message = office->pClass->getError(office);
        if (message) {
            fputs(message, stderr);
            office->pClass->freeError(message);
        }
    }
    office->pClass->destroy(office);
    return exported ? 0 : 1;
}
