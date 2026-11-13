/* Single-document LibreOfficeKit export, launched inside the codec sandbox. */
#include <stdbool.h>
#include <LibreOfficeKit/LibreOfficeKitInit.h>

int main(int argc, char **argv)
{
    if (argc != 5) {
        return 2;
    }
    LibreOfficeKit *office = lok_init_2(argv[1], argv[2]);
    if (!office) {
        return 10;
    }
    LibreOfficeKitDocument *document = office->pClass->documentLoadWithOptions(
        office, argv[3], "EnableMacrosExecution=false,MacroSecurityLevel=3");
    int status = 11;
    if (document) {
        status = document->pClass->saveAs(document, argv[4], "pdf", NULL) ? 0 : 12;
        document->pClass->destroy(document);
    }
    office->pClass->destroy(office);
    return status;
}
