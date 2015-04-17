//Author-Hans Kellner
//Description-Parametrically drive a user parameter

/*!
Copyright (C) 2015 Hans Kellner: https://github.com/hanskellner/Fusion360ParaParam
MIT License: See https://github.com/hanskellner/Fusion360ParaParam/LICENSE.md
*/

/*
This is a script for Autodesk Fusion 360 that parametrically drives a user parameter.

Installation:

Copy this scripts folder into your Fusion 360 "My Scripts" folder. You may find this folder using the following steps:

1) Start Fusion 360 and then select the File -> Scripts... menu item
2) The Scripts Manager dialog will appear and display the "My Scripts" folder and "Sample Scripts" folders
3) Select one of the "My Scripts" files and then click on the "+" Details icon near the bottom of the dialog.
  a) If there are no files in the "My Scripts" folder then create a default one.
  b) Click the Create button, select JavaScript, and then OK.
5) With the user script selected, click the Full Path "..." button to display a file explorer window that will display the "My Scripts" folder
6) Copy the files into the folder

For example, on a Mac the folder is located in:
/Users/USERNAME/Library/Application Support/Autodesk/Autodesk Fusion 360/API/Scripts

*/

/*globals adsk*/
(function () {

    "use strict";

    if (adsk.debug === true) {
        /*jslint debug: true*/
        debugger;
        /*jslint debug: false*/
    }

    var PARAM_OPERATION = {
        LOOP_ONLY: 0,
        //CLONE_SELECTION: 1,
        EXPORT_FUSION: 1,
        EXPORT_IGES: 2,
        EXPORT_SAT: 3,
        EXPORT_SMT: 4,
        EXPORT_STEP: 5,
        EXPORT_STL: 6,
        LAST: 6
    };

    var appTitle = 'ParaParam';

    var app = adsk.core.Application.get(), ui;
    if (app) {
        ui = app.userInterface;
        if (!ui) {
            adsk.terminate();
            return;
        }
    }

    var design = adsk.fusion.Design(app.activeProduct);
    if (!design) {
        ui.messageBox('No active design', appTitle);
        adsk.terminate();
        return;
    }

    // Get the current user parameters
    var paramsList = design.userParameters;

    // Create the command definition.
    var createCommandDefinition = function() {
        var commandDefinitions = ui.commandDefinitions;

        // Be fault tolerant in case the command is already added...
        var cmDef = commandDefinitions.itemById('ParaParam');
        if (!cmDef) {
            cmDef = commandDefinitions.addButtonDefinition('ParaParam',
                    'ParaParam',
                    'Parametrically drives a user parameter.',
                    './resources'); // relative resource file path is specified
        }
        return cmDef;
    };

    // CommandCreated event handler.
    var onCommandCreated = function(args) {
        try {
            // Connect to the CommandExecuted event.
            var command = args.command;
            command.execute.add(onCommandExecuted);

            // Terminate the script when the command is destroyed
            command.destroy.add(function () { adsk.terminate(); });

            // Define the inputs.
            var inputs = command.commandInputs;

            var paramInput = inputs.addDropDownCommandInput('param', 'Which Parameter', adsk.core.DropDownStyles.TextListDropDownStyle );

            // Get the parameter names
            for (var iParam = 0; iParam < paramsList.count; ++iParam) {
                paramInput.listItems.add(paramsList.item(iParam).name,(iParam === 0));
            }

            var valueStart = adsk.core.ValueInput.createByReal(1.0);
            inputs.addValueInput('valueStart', 'Start Value', 'cm' , valueStart);

            var valueEnd = adsk.core.ValueInput.createByReal(10.0);
            inputs.addValueInput('valueEnd', 'End Value', 'cm' , valueEnd);

            var valueInc = adsk.core.ValueInput.createByReal(1.0);
            inputs.addValueInput('valueInc', 'Increment Value', 'cm' , valueInc);

            var operInput = inputs.addDropDownCommandInput('operation', 'Operation', adsk.core.DropDownStyles.TextListDropDownStyle );
            operInput.listItems.add('Value Only',true);
            //operInput.listItems.add('Clone Selected Bodies',false);
            operInput.listItems.add('Export to Fusion',false);
            operInput.listItems.add('Export to IGES',false);
            operInput.listItems.add('Export to SAT',false);
            operInput.listItems.add('Export to SMT',false);
            operInput.listItems.add('Export to STEP',false);
            operInput.listItems.add('Export to STL',false);

            //SelectionCommandInput
            //var selInput = inputs.addSelectionInput('selection','Selection','Select bodies for operation or none');
            //selInput.addSelectionFilter( 'Bodies' );    // and Faces and/or sketch elements?

            //BoolValueCommandInput
            inputs.addBoolValueInput('pause', 'Pause each iteration', true);
        }
        catch (e) {
            ui.messageBox('Failed to create command : ' + (e.description ? e.description : e));
        }
    };

    // CommandExecuted event handler.
    var onCommandExecuted = function(args) {
        try {

            // Extract input values
            var unitsMgr = app.activeProduct.unitsManager;
            var command = adsk.core.Command(args.firingEvent.sender);
            var inputs = command.commandInputs;

            var paramInput, valueStartInput, valueEndInput, valueIncInput, operationInput, selInput, pauseInput;

            // REVIEW: Problem with a problem - the inputs are empty at this point. We
            // need access to the inputs within a command during the execute.
            for (var n = 0; n < inputs.count; n++) {
                var input = inputs.item(n);
                if (input.id === 'param') {
                    paramInput = adsk.core.DropDownCommandInput(input);
                }
                else if (input.id === 'valueStart') {
                    valueStartInput = adsk.core.ValueCommandInput(input);
                }
                else if (input.id === 'valueEnd') {
                    valueEndInput = adsk.core.ValueCommandInput(input);
                }
                else if (input.id === 'valueInc') {
                    valueIncInput = adsk.core.ValueCommandInput(input);
                }
                else if (input.id === 'operation') {
                    operationInput = adsk.core.DropDownCommandInput(input);
                }
                else if (input.id === 'selection') {
                    selInput = adsk.core.SelectionCommandInput(input);
                }
                else if (input.id === 'pause') {
                    pauseInput = adsk.core.BoolValueCommandInput(input);
                }
            }

            if (!paramInput || !valueStartInput || !valueEndInput || !valueIncInput || !operationInput || !pauseInput) { // || !selInput) {
                ui.messageBox("One of the inputs does not exist.");
                return;
            }

            // holds the parameters that drive the parameter.  How meta!
            var params = {
                paramName: "",
                valueStart: 0.0,
                valueEnd: 1.0,
                valueInc: 0.1,
                operation: PARAM_OPERATION.LOOP_ONLY,
                pause: false,
                exportFilename: ""
            };

            var iParam = paramInput.selectedItem.index;
            if (iParam < 0) {
                ui.messageBox("No parameter name selected");
                return false;
            }

            params.paramName = paramsList.item(iParam).name;

            params.valueStart = unitsMgr.evaluateExpression(valueStartInput.expression);
            params.valueEnd = unitsMgr.evaluateExpression(valueEndInput.expression);
            params.valueInc = unitsMgr.evaluateExpression(valueIncInput.expression);

            params.operation = operationInput.selectedItem.index;
            if (params.operation < 0 || params.operation > PARAM_OPERATION.LAST) {
                ui.messageBox("Invalid operation");
                return false;
            }

            var isExporting = (params.operation >= PARAM_OPERATION.EXPORT_FUSION && params.operation <= PARAM_OPERATION.EXPORT_STL);

            params.pause = pauseInput.value;

            // If operation is an export then prompt for folder location.
            if (isExporting) {

                // Prompt for the base filename to use for the exports.  This will
                // be appended with a counter or step value.
                var dlg = ui.createFileDialog();
                dlg.title = 'Select Export Filename';
                dlg.filter = 'All Files (*.*)';
                if (dlg.showSave() !== adsk.core.DialogResults.DialogOK) {
                    return false;
                }

                // Strip extension
                var filename = dlg.filename;
                var extIdx = filename.lastIndexOf('.');
                if (extIdx >= 0) {
                    filename = filename.substring(0, extIdx);
                }

                if (filename === '') {
                    ui.messageBox('Invalid export filename');
                    return false;
                }

                params.exportFilename = filename;
            }

            // Validate loop params
            if (params.valueInc <= 0) {
                ui.messageBox("Value increment must be positive and none zero");
                return false;
            }

            if (params.valueStart > params.valueEnd) {
                params.valueInc = -params.valueInc;
            }
            else if (params.valueStart == params.valueEnd) {
                ui.messageBox("Start value must not equal end value");
                return false;
            }

            // Get the actual parameter to modify
            var param = paramsList.itemByName(params.paramName);
            if (!param) {
                return false;
            }

            var exportMgr = design.exportManager;   // used if exporting
            var resExport = 0;

            // Loop from valueStart to valueEnd incrementing by valueInc
            for (var iStep = params.valueStart;
                 (params.valueInc > 0) ? iStep <= params.valueEnd : iStep >= params.valueEnd;
                 iStep += params.valueInc) {

                // note - setting the 'value' property does not change the value.  Must set expression
                param.expression = '' + iStep; // + ' cm';

                // If exporting then we need to build the name for this iteration
                var exportFilenamePrefix = params.exportFilename;
                if (isExporting) {
                    exportFilenamePrefix += '_'+params.paramName+'_'+iStep;
                }

                // Now do the post increment operation
                switch (params.operation)
                {
                    case PARAM_OPERATION.LOOP_ONLY:
                        // Nothing
                        break;

                    case PARAM_OPERATION.CLONE_SELECTION:
                        // Need to clone selected bodies
                        var selCount = selInput.selectionCount;
                        if (selCount > 0) {
                            for (var iSel = 0; iSel < selCount; ++iSel) {
                                var selItem = selInput.selection(iSel);
                                //if (selItem.objectType === 'BRepBody')
                                if (selItem.copy()) {
                                    // ARGH - No support for paste in the API
                                }
                            }
                        }

                        break;

                    case PARAM_OPERATION.EXPORT_FUSION:
                        var fusionArchiveOptions = exportMgr.createFusionArchiveExportOptions(exportFilenamePrefix+'.f3d');
                        resExport = exportMgr.execute(fusionArchiveOptions);
                        break;

                    case PARAM_OPERATION.EXPORT_IGES:
                        var igesOptions = exportMgr.createIGESExportOptions(exportFilenamePrefix+'.igs');
                        resExport = exportMgr.execute(igesOptions);
                        break;

                    case PARAM_OPERATION.EXPORT_SAT:
                        var satOptions = exportMgr.createSATExportOptions(exportFilenamePrefix+'.sat');
                        resExport = exportMgr.execute(satOptions);
                        break;

                    case PARAM_OPERATION.EXPORT_SMT:
                        var smtOptions = exportMgr.createSMTExportOptions(exportFilenamePrefix+'.smt');
                        resExport = exportMgr.execute(smtOptions);
                        break;

                    case PARAM_OPERATION.EXPORT_STEP:
                        var stepOptions = exportMgr.createSTEPExportOptions(exportFilenamePrefix+'.step');
                        resExport = exportMgr.execute(stepOptions);
                        break;

                    case PARAM_OPERATION.EXPORT_STL:
                        var stlOptions = exportMgr.createSTLExportOptions(design.rootComponent, exportFilenamePrefix+'.stl');
                        stlOptions.isBinaryFormat = true;
                        stlOptions.meshRefinement = adsk.fusion.MeshRefinementSettings.MeshRefinementHigh;
                        resExport = exportMgr.execute(stlOptions);
                        break;
                }

                // Pause each iteration?
                if (params.pause) {
                    //DialogResults
                    var dlgres = ui.messageBox('Pausing iteration at ' + iStep, 'Iteration Paused', adsk.core.MessageBoxButtonTypes.OKCancelButtonType);
                    if (dlgres !== 0) {
                        break;  // Cancel iteration.
                    }
                }
            }
        }
        catch (e) {
            ui.messageBox('Failed to execute command : ' + (e.description ? e.description : e));
        }
    };

    // Create and run command
	try {
        var command = createCommandDefinition();
        var commandCreatedEvent = command.commandCreated;
        commandCreatedEvent.add(onCommandCreated);

        command.execute();
    }
    catch (e) {
        ui.messageBox('Script Failed : ' + (e.description ? e.description : e));
        adsk.terminate();
    }

}());
