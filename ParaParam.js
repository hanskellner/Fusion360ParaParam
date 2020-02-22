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

// /Volumes/Master/Users/hans/Library/Containers/com.autodesk.mas.fusion360/Data/Library/Application Support/Autodesk/Autodesk Fusion 360/API/Scripts/

/*globals adsk*/
function run(context) {

    "use strict";

    if (adsk.debug === true) {
        /*jslint debug: true*/
        debugger;
        /*jslint debug: false*/
    }

    var PARAM_OPERATION = {
        LOOP_ONLY: 0,
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

    var progressDialog = null;

    // What to do after each update (export, etc)
    var paramOperation = null;

    // This is the parameter info to update.  The format is:
    //   ParamName, StartValue, EndValue, StepValue
    var paramsInfo = [];

    // Get the current user parameters
    var userParamsList = design.userParameters;

    var paramGroupInput = null; // Group input control in dialog

    // Create the command definition.
    var createCommandDefinition = function() {
        var commandDefinitions = ui.commandDefinitions;

        // Be fault tolerant in case the command is already added...
        var cmDef = commandDefinitions.itemById('ParaParam');
        if (!cmDef) {
            cmDef = commandDefinitions.addButtonDefinition('ParaParam',
                    'ParaParam',
                    'Parametrically drives user parameters.',
                    './resources'); // relative resource file path is specified
        }
        return cmDef;
    };

    // CommandCreated event handler.
    var onCommandCreated = function(args) {
        try {
            var command = args.command;

            // Connect to the events.
            command.execute.add(onCommandExecuted);
            command.inputChanged.add(onInputChangedHandler);

            // Terminate the script when the command is destroyed
            command.destroy.add(function () { adsk.terminate(); });

            // Define the inputs.
            var inputs = command.commandInputs;

            var paramInput = inputs.addDropDownCommandInput('param', 'Which Parameter', adsk.core.DropDownStyles.TextListDropDownStyle );

            // The first item indicates a CSV file for param info should be selected and used
            paramInput.listItems.add("Use Param CSV File", true);

            // Add the user parameter names
            for (var iParam = 0; iParam < userParamsList.count; ++iParam) {
                paramInput.listItems.add(userParamsList.item(iParam).name, false);
            }

            // Create group to hold single param inputs (non CSV)
            var groupInput = inputs.addGroupCommandInput("groupinput", "Single Parameter");
            groupInput.isExpanded = true;
            groupInput.isEnabled = true;

            paramGroupInput = groupInput;   // HACK: Save off so changed handler can ref

            var valueStart = adsk.core.ValueInput.createByReal(1.0);
            groupInput.children.addValueInput('valueStart', 'Start Value', 'cm' , valueStart);

            var valueEnd = adsk.core.ValueInput.createByReal(10.0);
            groupInput.children.addValueInput('valueEnd', 'End Value', 'cm' , valueEnd);

            var valueStep = adsk.core.ValueInput.createByReal(1.0);
            groupInput.children.addValueInput('valueStep', 'Increment Value', 'cm' , valueStep);

            // Operation section

            var operInput = inputs.addDropDownCommandInput('operation', 'Operation', adsk.core.DropDownStyles.TextListDropDownStyle );
            operInput.listItems.add('Value Only',true);
            operInput.listItems.add('Export to Fusion',false);
            operInput.listItems.add('Export to IGES',false);
            operInput.listItems.add('Export to SAT',false);
            operInput.listItems.add('Export to SMT',false);
            operInput.listItems.add('Export to STEP',false);
            operInput.listItems.add('Export to STL',false);

            var exportSTLPerBody = inputs.addBoolValueInput('exportSTLPerBody', 'Export STL for each body', true);
            exportSTLPerBody.value = false;

            var restoreValues = inputs.addBoolValueInput('restoreValues', 'Restore Values On Finish', true);
            restoreValues.value = false;
        }
        catch (e) {
            ui.messageBox('Failed to create command : ' + (e.message ? e.message : e));
        }
    };

    // Event handler for the inputChanged event.
    var onInputChangedHandler = function(args) {
        eventArgs = adsk.core.InputChangedEventArgs(args);

        var cmdInput = eventArgs.input;
        if (cmdInput != null)
        {
            if (cmdInput.id == "param") {
                var paramInput = adsk.core.DropDownCommandInput(cmdInput);

                var iParam = paramInput.selectedItem.index;
                if (paramGroupInput) {
                    var enable = (iParam > 0);   // Enable/Disable group
                    //paramGroupInput.isEnabled = enable;
                    paramGroupInput.isExpanded = enable;
                }
            }
            /** TODO: Enable/Disable checkbox depending on operation
            else if (cmdInput.id == "operation") {
                //var exportInput = adsk.core.BoolValueCommandInput(cmdInput);
                var operationInput = adsk.core.DropDownCommandInput(cmdInput);
                var paramOperation = operationInput.selectedItem.index;
                val bEnableBoolInput = (paramOperation == PARAM_OPERATION.EXPORT_STL);
            }
             */
        }
    };

    var Uint8ToString = function(u8Arr) {
        var CHUNK_SIZE = 0x8000; //arbitrary number
        var index = 0;
        var length = u8Arr.length;
        var result = '';
        var slice;
        while (index < length) {
            slice = u8Arr.subarray(index, Math.min(index + CHUNK_SIZE, length));
            result += String.fromCharCode.apply(null, slice);
            index += CHUNK_SIZE;
        }
        return result; //btoa(result);
    };

    var decode_utf8 = function(s)
    {
        return decodeURIComponent(escape(s));
    }

    var LoadParamsCSVFile = function() {

        // prompt for the filename
        var dlg = ui.createFileDialog();
        dlg.title = 'Select Parameters CSV File';
        dlg.filter = 'CSV Files (*.csv);;All Files (*.*)';

        if (dlg.showOpen() != adsk.core.DialogResults.DialogOK)
            return false;

        var csvFilename = dlg.filename;

        // Read the csv file.
        var cnt = 0;
        var arrayBuffer = adsk.readFile(csvFilename);
        var allLines = decode_utf8(Uint8ToString(new Uint8Array(arrayBuffer)));

        var linesCSV = allLines.split(/\r?\n/);

        var linesCSVCount = linesCSV.length;
        for (var i = 0; i < linesCSVCount; ++i) {

            var line = linesCSV[i].trim();

            // Is this line empty?
            if (line === "") {

                // Skip over multiple blank lines (treat as one)
                for (++i ; line === "" && i < linesCSVCount; ++i) {
                    line = linesCSV[i].trim();
                }

                if (i == linesCSVCount) {
                    break;  // No more lines
                }
            }

            // Get the values from the csv line.
            // Format:
            //  ParamName, StartValue, EndValue, Step
            var pieces = line.split(',');

            if ( pieces.length != 4 ) {
                ui.messageBox("Invalid line: " + cnt + " - CSV file: " + csvFilename);
                adsk.terminate();
            }

            if (isNaN(pieces[1]) || isNaN(pieces[2]) || isNaN(pieces[3])) {
                ui.messageBox("Invalid param value at line: " + cnt + " - CSV file: " + csvFilename);
                adsk.terminate();
            }

            var paramName  = pieces[0];
            var paramStart = Number(pieces[1]);
            var paramEnd   = Number(pieces[2]);
            var paramStep  = Number(pieces[3]);

            paramsInfo.push({name: paramName, valueStart: paramStart, valueEnd: paramEnd, valueStep: paramStep});

            cnt += 1;
        }

        return true;
    };

    // Now begin the param updates.  This is a recursive function which will
    // iterate over each param and update.
    var UpdateParams = function(whichParam, paramValues, exportFilenamePrefix, exportSTLPerBody) {

        var curParam = paramsInfo[whichParam];

        // Validate loop params
        if (curParam.valueStep <= 0) {
            ui.messageBox("Value increment must be greater than zero");
            return false;
        }

        if (curParam.valueStart > curParam.valueEnd) {
            curParam.valueStep = -curParam.valueStep;
        }
        else if (curParam.valueStart == curParam.valueEnd) {
            ui.messageBox("Start value must not equal End value");
            return false;
        }

        // Get the actual parameter to modify
        var userParam = userParamsList.itemByName(curParam.name);
        if (!userParam) {
            return false;
        }

        var resExport = 0;

        // Loop from valueStart to valueEnd incrementing by valueStep
        for (var val = curParam.valueStart;
             (curParam.valueStep > 0) ? val <= curParam.valueEnd : val >= curParam.valueEnd;
             val += curParam.valueStep) {

            // note - setting the 'value' property does not change the value.  Must set expression.
            // REVIEW: Handle unit conversion
            userParam.expression = '' + val; // + ' cm';

            // TODO: dialog not hiding at end
            //progressDialog.message = "Updating parameter '" + curParam.name + "' to " + userParam.expression;

            // Track in running values
            paramValues[curParam.name] = userParam.expression;

            // If exporting then we need to build the name for this iteration
            var exportFilename = "";
            if (exportFilenamePrefix && exportFilenamePrefix !== "") {
                // TODO: Better name based on all params
                exportFilename = exportFilenamePrefix + '_' + curParam.name + '_' + val;
            }

            // Is this a leaf node?
            if ( whichParam == paramsInfo.length - 1 ) {

                // Yes, so perform the operation specified.
                var exportMgr = design.exportManager;

                switch (paramOperation)
                {
                    case PARAM_OPERATION.LOOP_ONLY:
                        // Nothing
                        break;

                    case PARAM_OPERATION.EXPORT_FUSION:
                        var fusionArchiveOptions = exportMgr.createFusionArchiveExportOptions(exportFilename+'.f3d');
                        resExport = exportMgr.execute(fusionArchiveOptions);
                        break;

                    case PARAM_OPERATION.EXPORT_IGES:
                        var igesOptions = exportMgr.createIGESExportOptions(exportFilename+'.igs');
                        resExport = exportMgr.execute(igesOptions);
                        break;

                    case PARAM_OPERATION.EXPORT_SAT:
                        var satOptions = exportMgr.createSATExportOptions(exportFilename+'.sat');
                        resExport = exportMgr.execute(satOptions);
                        break;

                    case PARAM_OPERATION.EXPORT_SMT:
                        var smtOptions = exportMgr.createSMTExportOptions(exportFilename+'.smt');
                        resExport = exportMgr.execute(smtOptions);
                        break;

                    case PARAM_OPERATION.EXPORT_STEP:
                        var stepOptions = exportMgr.createSTEPExportOptions(exportFilename+'.step');
                        resExport = exportMgr.execute(stepOptions);
                        break;

                    case PARAM_OPERATION.EXPORT_STL:

                        if ( exportSTLPerBody ) {
                            var bodies = design.rootComponent.bRepBodies;
                            for (var iBodies=0; iBodies < bodies.count; iBodies++)
                            {
                                var body = bodies.item(iBodies);
                                var name = body.name;
                                console.log("STL Export Body '"+body+"' : Name '"+name+"'");

                                // Create a clean filename
                                var exportFilename = exportFilenamePrefix + '_' + name + '_' + curParam.name + '_' + val + '.stl';

                                var stlOptions = exportMgr.createSTLExportOptions(body, exportFilename);

                                //stlOptions.isBinaryFormat = true;
                                //stlOptions.isBinaryFormat = true;
                                //stlOptions.meshRefinement = adsk.fusion.MeshRefinementSettings.MeshRefinementHigh;
                                resExport = exportMgr.execute(stlOptions);
                            }
                        }
                        else {
                            var stlOptions = exportMgr.createSTLExportOptions(design.rootComponent, exportFilename+'.stl');
                            //stlOptions.isBinaryFormat = true;
                            //stlOptions.meshRefinement = adsk.fusion.MeshRefinementSettings.MeshRefinementHigh;
                            resExport = exportMgr.execute(stlOptions);
                        }

                        break;
                }
            }
            else { // Not a leaf node so iterate downward

                for (var iParam = whichParam+1; iParam < paramsInfo.length; ++iParam) {
                    UpdateParams(iParam, paramValues, exportFilename, false);
                }
            }
        }
    };

    // CommandExecuted event handler.
    var onCommandExecuted = function(args) {
        try {

            // Extract input values
            var unitsMgr = app.activeProduct.unitsManager;
            var command = adsk.core.Command(args.firingEvent.sender);
            var inputs = command.commandInputs;

            var paramInput, valueStartInput, valueEndInput, valueStepInput, operationInput, exportSTLPerBodyInput, restoreValuesInput;

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
                else if (input.id === 'valueStep') {
                    valueStepInput = adsk.core.ValueCommandInput(input);
                }
                else if (input.id === 'operation') {
                    operationInput = adsk.core.DropDownCommandInput(input);
                }
                else if (input.id === 'exportSTLPerBody') {
                    exportSTLPerBodyInput = adsk.core.BoolValueCommandInput(input);
                }
                else if (input.id === 'restoreValues') {
                    restoreValuesInput = adsk.core.BoolValueCommandInput(input);
                }
            }

            if (!paramInput || !valueStartInput || !valueEndInput || !valueStepInput || !operationInput || !exportSTLPerBodyInput || !restoreValuesInput) {
                ui.messageBox("One of the inputs does not exist.");
                return;
            }

            // What param to use or param CSV file?
            var iParam = paramInput.selectedItem.index;
            if (iParam < 0) {
                ui.messageBox("No parameter selected");
                return false;
            }

            // Use param CSV file?
            if (iParam == 0) {
                // Prompt for then load param info from file.
                if (!LoadParamsCSVFile()) {
                    return false;
                }
            }
            else {
                // Add single param info to the list.
                paramsInfo.push({
                    name:       userParamsList.item(iParam-1).name,     // Note, subtract 1 since iParam == 0 is CSV file entry
                    valueStart: unitsMgr.evaluateExpression(valueStartInput.expression),
                    valueEnd:   unitsMgr.evaluateExpression(valueEndInput.expression),
                    valueStep:  unitsMgr.evaluateExpression(valueStepInput.expression)
                });
            }

            // What to do after each param update?
            paramOperation = operationInput.selectedItem.index;
            if (paramOperation < 0 || paramOperation > PARAM_OPERATION.LAST) {
                ui.messageBox("Invalid operation");
                return false;
            }

            // If operation is an export then prompt for folder location.
            var exportFilenamePrefix = "";
            var isExporting = (paramOperation >= PARAM_OPERATION.EXPORT_FUSION && paramOperation <= PARAM_OPERATION.EXPORT_STL);
            if (isExporting) {

                // Prompt for the base filename to use for the exports.  This will
                // be appended with a counter or step value.
                var dlg = ui.createFileDialog();
                dlg.title = 'Select Export Filename Prefix';
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

                // TESTING
                //var tmpDir = adsk.tempDirectory();
                //exportFilenamePrefix = tmpDir + "test";
                // "/var/folders/hx/nckzmpbd78xgd90krgjrwq940000gn/T/com.autodesk.mas.fusion360/test_Width_1"

                exportFilenamePrefix = filename;
            }

            // Before doing the potential long param update operations, display a progress dialog
            // TODO: dialog not hiding at end
            //progressDialog = ui.createProgressDialog();
            //progressDialog.cancelButtonText = 'Cancel';
            //progressDialog.isBackgroundTranslucent = false;
            //progressDialog.isCancelButtonShown = true;

            // Show dialog
            //progressDialog.show('ParaParam Progress', 'Generating parameters...', 0, paramsInfo.length);

            // How many params are we changing?
            var paramsCount = paramsInfo.length;

            // Track current param value (expression) while iterating over all
            var paramValues = {};

            // Save off the original param values so we can restore later
            var userParamValuesOriginal = [];
            for (var iParam = 0; iParam < paramsCount; ++iParam) {

                // Get the custom param info
                var curParam = paramsInfo[iParam];

                // Get the actual parameter to modify
                var userParam = userParamsList.itemByName(curParam.name);
                if (!userParam) {
                    break;
                }

                userParamValuesOriginal[curParam.name] = userParam.expression;

                paramValues[curParam.name] = userParam.expression;
            }

            // Now begin the param updates.  This is a recursive function which will
            // iterate over each param and update.  It's really just a way of doing
            // the following but for an arbitrary number of params:
            // for (i = 0; i < iCount; ++i)
            //   for (j = 0; j < jCount; ++j)
            //     for (k = 0; k < kCount; ++k)
            //       print value(i,j,k)
            UpdateParams(0, paramValues, exportFilenamePrefix, exportSTLPerBodyInput.value);

            // Restore original param values on finish?
            if ( restoreValuesInput.value ) {
                for (var paramName in userParamValuesOriginal) {
                    if (userParamValuesOriginal.hasOwnProperty(paramName)) {
                        // Get the actual parameter to modify
                        var userParam = userParamsList.itemByName(paramName);
                        userParam.expression = userParamValuesOriginal[paramName];
                    }
                }
            }
        }
        catch (e) {
            ui.messageBox('Failed to execute command : ' + (e.description ? e.description : e));
        }

        // Make sure this is gone.  Sometimes hangs around!
        // TODO: dialog not hiding at end
        //if (progressDialog) {
        //    progressDialog.hide();
        //    progressDialog = null;
        //}
    };

    // Create and run command
	try {
        var command = createCommandDefinition();
        var commandCreatedEvent = command.commandCreated;
        commandCreatedEvent.add(onCommandCreated);

        command.execute();
    }
    catch (e) {
        ui.messageBox('Script Failed : ' + (e.message ? e.message : e));
        adsk.terminate();
    }
}
