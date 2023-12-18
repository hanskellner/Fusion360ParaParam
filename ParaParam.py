#Author-Hans Kellner
#Description-Parametrically drive a user parameter

import adsk.core, adsk.fusion, adsk.cam, traceback
import csv, os, re

# Globals
_app = adsk.core.Application.cast(None)
_ui = adsk.core.UserInterface.cast(None)

_exportFolder = ''
_csvFolder = ''

_OP_LOOP_ONLY = 0
_OP_EXPORT_FUSION = 1
_OP_EXPORT_IGES = 2
_OP_EXPORT_SAT = 3
_OP_EXPORT_SMT = 4
_OP_EXPORT_STEP = 5
_OP_EXPORT_STL = 6

_OPERATIONS = [ "LoopOnly", "ExportFusion", "ExportIGES", "ExportSAT", "ExportSMT", "ExportSTEP", "ExportSTL" ]
_OPERATIONDEFAULT = "LoopOnly"

# Command inputs
_group_inputs = adsk.core.GroupCommandInput.cast(None)
_paramNameDropDown = adsk.core.DropDownCommandInput.cast(None)
_valueStartInput = adsk.core.ValueCommandInput.cast(None)
_valueEndInput = adsk.core.ValueCommandInput.cast(None)
_valueStepInput = adsk.core.ValueCommandInput.cast(None)
_operationDropDown = adsk.core.DropDownCommandInput.cast(None)
_unitsStandardDropDown = adsk.core.DropDownCommandInput.cast(None)
_exportSTLPerBodyBoolInput = adsk.core.BoolValueCommandInput.cast(None)
_restoreValuesBoolInput = adsk.core.BoolValueCommandInput.cast(None)

_handlers = []

def run(context):
    try:
        global _app, _ui
        _app = adsk.core.Application.get()
        _ui  = _app.userInterface

        cmdDef = _ui.commandDefinitions.itemById('ParaParamPythonScript')
        if not cmdDef:
            # Create a command definition.
            cmdDef = _ui.commandDefinitions.addButtonDefinition('ParaParamPythonScript', 'Para Param', 'Parametrically drive a user parameter.', 'resources/ParaParam') 
        
        # Connect to the command created event.
        onCommandCreated = ParaParamCommandCreatedHandler()
        cmdDef.commandCreated.add(onCommandCreated)
        _handlers.append(onCommandCreated)
        
        # Execute the command.
        cmdDef.execute()

        # prevent this module from being terminate when the script returns, because we are waiting for event handlers to fire
        adsk.autoTerminate(False)
    except:
        if _ui:
            _ui.messageBox('Failed:\n{}'.format(traceback.format_exc()))

class ParaParamCommandDestroyHandler(adsk.core.CommandEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        try:
            eventArgs = adsk.core.CommandEventArgs.cast(args)

            # when the command is done, terminate the script
            # this will release all globals which will remove all event handlers
            adsk.terminate()
        except:
            if _ui:
                _ui.messageBox('Failed:\n{}'.format(traceback.format_exc()))

# Verifies that a value command input has a valid expression and returns the 
# value if it does.  Otherwise it returns False.  This works around a 
# problem where when you get the value from a ValueCommandInput it causes the
# current expression to be evaluated and updates the display.  Some new functionality
# is being added in the future to the ValueCommandInput object that will make 
# this easier and should make this function obsolete.
def getCommandInputValue(commandInput, unitType):
    try:
        valCommandInput = adsk.core.ValueCommandInput.cast(commandInput)
        if not valCommandInput:
            return (False, 0)

        # Verify that the expression is valid.
        des = adsk.fusion.Design.cast(_app.activeProduct)
        unitsMgr = des.unitsManager
        
        if unitsMgr.isValidExpression(valCommandInput.expression, unitType):
            value = unitsMgr.evaluateExpression(valCommandInput.expression, unitType)
            return (True, value)
        else:
            return (False, 0)
    except:
        if _ui:
            _ui.messageBox('Failed:\n{}'.format(traceback.format_exc()))

# Event handler for the commandCreated event.
class ParaParamCommandCreatedHandler(adsk.core.CommandCreatedEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        try:
            eventArgs = adsk.core.CommandCreatedEventArgs.cast(args)
            
            # Verify that a Fusion design is active.
            des = adsk.fusion.Design.cast(_app.activeProduct)
            if not des:
                _ui.messageBox('A Fusion design must be active when invoking this command.')
                return()
                
            global _exportFolder, _csvFolder, _group_inputs, _paramNameDropDown, _valueStartInput, _valueEndInput, _valueStepInput, _operationDropDown, _unitsStandardDropDown, _exportSTLPerBodyBoolInput, _restoreValuesBoolInput, _errMessage

            paramName = ''
            paramNameAttrib = des.attributes.itemByName('ParaParam', 'paramName')
            if paramNameAttrib:
                paramName = paramNameAttrib.value
                
            startValueSetting = '1'
            startValueAttrib = des.attributes.itemByName('ParaParam', 'startValue')
            if startValueAttrib:
                startValueSetting = startValueAttrib.value

            endValueSetting = '5'
            endValueAttrib = des.attributes.itemByName('ParaParam', 'endValue')
            if endValueAttrib:
                endValueSetting = endValueAttrib.value

            stepValueSetting = '1'
            stepValueAttrib = des.attributes.itemByName('ParaParam', 'stepValue')
            if stepValueAttrib:
                stepValueSetting = stepValueAttrib.value

            operationSetting = _OPERATIONDEFAULT
            operationAttrib = des.attributes.itemByName('ParaParam', 'operation')
            if operationAttrib:
                operationSetting = operationAttrib.value
            
            exportSTLPerBodySetting = True
            exportSTLPerBodyAttrib = des.attributes.itemByName('ParaParam', 'exportSTLPerBody')
            if exportSTLPerBodyAttrib:
                exportSTLPerBodySetting = exportSTLPerBodyAttrib.value == 'True'
            
            restoreValuesSetting = True
            restoreValuesAttrib = des.attributes.itemByName('ParaParam', 'restoreValues')
            if restoreValuesAttrib:
                restoreValuesSetting = restoreValuesAttrib.value == 'True'

            _exportFolder = ''
            exportFolderAttrib = des.attributes.itemByName('ParaParam', 'exportFolder')
            if exportFolderAttrib:
                _exportFolder = exportFolderAttrib.value

            _csvFolder = ''
            csvFolderAttrib = des.attributes.itemByName('ParaParam', 'csvFolder')
            if csvFolderAttrib:
                _csvFolder = csvFolderAttrib.value

            cmd = eventArgs.command
            cmd.isExecutedWhenPreEmpted = False
            inputs = cmd.commandInputs
            
            # Define the command dialog.
            _paramNameDropDown = inputs.addDropDownCommandInput('param', 'Which Parameter', adsk.core.DropDownStyles.TextListDropDownStyle)

            # The first item indicates a CSV file for param info should be selected and used
            _paramNameDropDown.listItems.add("Use CSV File", paramName == '')

            # Add the user parameter names
            have_prev_param_name = False
            for i in range(des.userParameters.count):
                userParamName = des.userParameters.item(i).name
                match_param_name = userParamName == paramName
                if match_param_name:
                    have_prev_param_name = True
                _paramNameDropDown.listItems.add(userParamName, match_param_name)
            
            # If a previous user param name was not found then select Use CSV File item
            if not have_prev_param_name:
                _paramNameDropDown.listItems.item(0).isSelected = True

            # Create group to hold single param inputs
            _group_inputs = inputs.addGroupCommandInput("groupinput", "Single Parameter")

            _valueStartInput = _group_inputs.children.addValueInput('startValue', 'Start Value', '', adsk.core.ValueInput.createByString(startValueSetting))
            _valueEndInput = _group_inputs.children.addValueInput('endValue', 'End Value', '', adsk.core.ValueInput.createByString(endValueSetting))
            _valueStepInput = _group_inputs.children.addValueInput('stepValue', 'Step Value', '', adsk.core.ValueInput.createByString(stepValueSetting))

            _group_inputs.isExpanded = paramName != ''
            _group_inputs.isEnabled = True

            _operationDropDown = inputs.addDropDownCommandInput('operation', 'Operation', adsk.core.DropDownStyles.TextListDropDownStyle)
            for operation in _OPERATIONS:
                if operation == operationSetting:
                    _operationDropDown.listItems.add(operation, True)
                else:
                    _operationDropDown.listItems.add(operation, False)

            _exportSTLPerBodyBoolInput = inputs.addBoolValueInput('exportSTLPerBody', 'Export STL Per Body', True, '', exportSTLPerBodySetting)

            _restoreValuesBoolInput = inputs.addBoolValueInput('restoreValues', 'Restore Values', True, '', restoreValuesSetting)
            
            _errMessage = inputs.addTextBoxCommandInput('errMessage', '', '', 2, True)
            _errMessage.isFullWidth = True
            
            # Connect to the command related events.
            onExecute = ParaParamCommandExecuteHandler()
            cmd.execute.add(onExecute)
            _handlers.append(onExecute)        
            
            onInputChanged = ParaParamCommandInputChangedHandler()
            cmd.inputChanged.add(onInputChanged)
            _handlers.append(onInputChanged)     
            
            onValidateInputs = ParaParamCommandValidateInputsHandler()
            cmd.validateInputs.add(onValidateInputs)
            _handlers.append(onValidateInputs)

            onDestroy = ParaParamCommandDestroyHandler()
            cmd.destroy.add(onDestroy)
            _handlers.append(onDestroy)
        except:
            if _ui:
                _ui.messageBox('Failed:\n{}'.format(traceback.format_exc()))


# Event handler for the execute event.
class ParaParamCommandExecuteHandler(adsk.core.CommandEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        try:
            eventArgs = adsk.core.CommandEventArgs.cast(args)

            # Save the current values as attributes.
            des = adsk.fusion.Design.cast(_app.activeProduct)
            attribs = des.attributes

            # User param selected or use param CSV file?
            param_index = _paramNameDropDown.selectedItem.index
            if param_index > 0:
                attribs.add('ParaParam', 'paramName', _paramNameDropDown.selectedItem.name)
            else:
                attribs.add('ParaParam', 'paramName', '')

            attribs.add('ParaParam', 'operation', _operationDropDown.selectedItem.name)

            attribs.add('ParaParam', 'startValue', str(_valueStartInput.value))
            attribs.add('ParaParam', 'endValue', str(_valueEndInput.value))
            attribs.add('ParaParam', 'stepValue', str(_valueStepInput.value))

            attribs.add('ParaParam', 'exportSTLPerBody', str(_exportSTLPerBodyBoolInput.value))
            attribs.add('ParaParam', 'restoreValues', str(_restoreValuesBoolInput.value))

            # Get the current values.
            operation = _operationDropDown.selectedItem.name
            if _paramNameDropDown.selectedItem.index > 0:
                userParamName = _paramNameDropDown.selectedItem.name
            else:
                userParamName = ''
            startValue = _valueStartInput.value
            endValue = _valueEndInput.value
            stepValue = _valueStepInput.value
            exportSTLPerBody = _exportSTLPerBodyBoolInput.value
            restoreValues = _restoreValuesBoolInput.value 

            # Perform the operation.
            doParaParam(operation, userParamName, startValue, endValue, stepValue, exportSTLPerBody, restoreValues)

        except:
            if _ui:
                _ui.messageBox('Failed:\n{}'.format(traceback.format_exc()))
        
        
# Event handler for the inputChanged event.
class ParaParamCommandInputChangedHandler(adsk.core.InputChangedEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        try:
            eventArgs = adsk.core.InputChangedEventArgs.cast(args)
            changedInput = eventArgs.input

            if changedInput.id == 'param':
                if _paramNameDropDown.selectedItem.index == 0:
                    # Disable the single param inputs
                    #_group_inputs.isEnabled = False
                    _group_inputs.isExpanded = False
                else:
                    # Enable the single param inputs
                    #_group_inputs.isEnabled = True
                    _group_inputs.isExpanded = True

        except:
            if _ui:
                _ui.messageBox('Failed:\n{}'.format(traceback.format_exc()))
        
        
# Event handler for the validateInputs event.
class ParaParamCommandValidateInputsHandler(adsk.core.ValidateInputsEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        try:
            eventArgs = adsk.core.ValidateInputsEventArgs.cast(args)
            
            _errMessage.text = ''

            # User param selected or use param CSV file?
            param_index = _paramNameDropDown.selectedItem.index
            if param_index < 0:
                _errMessage.text = 'You must specify a user parameter name or choose to use CSV file.'
                eventArgs.areInputsValid = False
                return

            # Verify that start value != end value.
            if _valueStartInput.value == _valueEndInput.value:
                _errMessage.text = 'The start value must be different than end value.'
                eventArgs.areInputsValid = False
                return

            # Verify that step value > 0.
            if _valueStepInput.value <= 0:
                _errMessage.text = 'The step value must be greater than zero.'
                eventArgs.areInputsValid = False
                return

            # Verify that step value < (end value - start value).
            value_range = abs(_valueEndInput.value - _valueStartInput.value)
            if _valueStepInput.value <= 0 or _valueStepInput.value > value_range:
                _errMessage.text = 'The step value must be less than or equal to value range.'
                eventArgs.areInputsValid = False
                return

        except:
            if _ui:
                _ui.messageBox('Failed:\n{}'.format(traceback.format_exc()))

def is_number(s):
    try:
        float(s)
        return True
    except ValueError:
        return False
    
def getCSVFile():
    try:

        global _csvFolder

        des = adsk.fusion.Design.cast(_app.activeProduct)

        # Set styles of file dialog.
        fileDlg = _ui.createFileDialog()
        fileDlg.isMultiSelectEnabled = False
        fileDlg.title = 'Select Parameters CSV File'
        fileDlg.filter = 'CSV Files (*.csv);;All Files (*.*)'
        if _csvFolder != '':
            fileDlg.initialDirectory = _csvFolder
        
        # Show file open dialog
        dlgResult = fileDlg.showOpen()
        if dlgResult != adsk.core.DialogResults.DialogOK:
            return []

        # Save the current folder values as attributes.
        attribs = des.attributes
        _csvFolder = os.path.dirname(fileDlg.filename)
        attribs.add('ParaParam', 'csvFolder', _csvFolder)

        # Get the CSV file.
        csv_params = []
        with open(fileDlg.filename) as csv_file:

            reader = csv.reader(csv_file)

            # Skip the header row.
            #next(reader)

            for csv_row in reader:
                # Validate the row.
                if len(csv_row) != 4:
                    _ui.messageBox("Values missing in line - File: '" + fileDlg.filename + "' - Line '" + str(csv_row) + "'")
                    return []
                
                for i in range(3):
                    if is_number(csv_row[i+1]) == False:
                        _ui.messageBox("Invalid value - File: " + fileDlg.filename + " - Line: '" + str(csv_row) + "'")
                        return []

                # Add the row to the list but convert the values to floats.
                csv_params.append([csv_row[0], float(csv_row[1]), float(csv_row[2]), float(csv_row[3])])

        return csv_params
    
    except:
        if _ui:
            _ui.messageBox('ParaParam Failed:\n{}'.format(traceback.format_exc()))

# crappy Python doesn't support float ranges.
# This is a custom range function that supports floats and also 
# negative increments.
def decimal_range(start, stop, increment):
    if increment > 0:
        while start <= stop: # and not math.isclose(start, stop): Py>3.5
            yield start
            start += increment
    else:
        while start >= stop:
            yield start
            start += increment

# Now begin the param updates.  This is a recursive function which will
# iterate over each param and update.
def updateParams(paraParams, paramIndex, paramValues, exportSTLPerBody, operation):

    global _OP_LOOP_ONLY, _OP_EXPORT_FUSION, _OP_EXPORT_IGES, _OP_EXPORT_SAT, _OP_EXPORT_SMT, _OP_EXPORT_STEP, _OP_EXPORT_STL
    global _exportFolder

    curParam = paraParams[paramIndex]

    curParamName = curParam[0]
    curParamStart = curParam[1]
    curParamEnd = curParam[2]
    curParamStep = curParam[3]

    # Reverse the step if the start is greater than the end
    if curParamStart > curParamEnd:
        curParamStep = -curParamStep

    # Get the actual parameter to modify
    des = adsk.fusion.Design.cast(_app.activeProduct)
    userParam = des.userParameters.itemByName(curParamName)
    if userParam is None:
        return False

    # Create the list of param names that will be used to build the filename
    # REVIEW: Better name based on all params?
    # REVIEW: Clean names for valid filenames?
    parentParamNameVals = ''
    for i in range(len(paraParams) - 1):
        parentParamName = paraParams[i][0]
        if parentParamNameVals != '':
            parentParamNameVals += '_'
        parentParamNameVals += parentParamName + '_' + str(paramValues[parentParamName])

    if parentParamNameVals != '':
        parentParamNameVals += '_'
    parentParamNameVals += curParamName

    parentParamNameVals = re.sub(r"\s+", '_', parentParamNameVals)
    parentParamNameVals = parentParamNameVals.replace('.', '_')

    resExport = 0

    # Loop from valueStart to valueEnd incrementing by valueStep
    for val in decimal_range(curParamStart, curParamEnd, curParamStep):

        # NOTE: setting the 'value' property does not change the value.  Must set expression.
        # REVIEW: Handle unit conversion?
        userParam.expression = str(val); # + ' cm';

        # Track in running values
        paramValues[curParamName] = userParam.expression

        adsk.doEvents() # Allow UI to update

        _app.activeViewport.refresh() # Force viewport to update

        # If exporting then we need to build the name for this iteration
        # HACK: Really need to come up with a better way to do this.
        exportFilename = ''
        if _exportFolder != None and _exportFolder != '':
            # REVIEW: Better name based on all params?
            exportFilename = _exportFolder + '/' + _app.activeDocument.name + '_' + parentParamNameVals + '_' + str(val).replace('.', '_')

        # Is this a leaf node?
        if paramIndex == len(paramValues) - 1:

            # Yes, so perform the operation specified.
            exportMgr = des.exportManager

            if operation == _OPERATIONS[_OP_LOOP_ONLY]:
                # Do nothing
                pass
            elif operation == _OPERATIONS[_OP_EXPORT_FUSION]:
                fusionArchiveOptions = exportMgr.createFusionArchiveExportOptions(exportFilename+'.f3d')
                resExport = exportMgr.execute(fusionArchiveOptions)
            elif operation == _OPERATIONS[_OP_EXPORT_IGES]:
                igesOptions = exportMgr.createIGESExportOptions(exportFilename+'.igs')
                resExport = exportMgr.execute(igesOptions)
            elif operation == _OPERATIONS[_OP_EXPORT_SAT]:
                satOptions = exportMgr.createSATExportOptions(exportFilename+'.sat')
                resExport = exportMgr.execute(satOptions)
            elif operation == _OPERATIONS[_OP_EXPORT_SMT]:
                smtOptions = exportMgr.createSMTExportOptions(exportFilename+'.smt')
                resExport = exportMgr.execute(smtOptions)
            elif operation == _OPERATIONS[_OP_EXPORT_STEP]:
                stepOptions = exportMgr.createSTEPExportOptions(exportFilename+'.step');
                resExport = exportMgr.execute(stepOptions)
            elif operation == _OPERATIONS[_OP_EXPORT_STL]:
                # If exporting per body selected but not bodies, fall back to normal stl export
                if exportSTLPerBody and des.rootComponent.bRepBodies.count > 0:
                    bodies = des.rootComponent.bRepBodies
                    for iBodies in range(bodies.count):
                        body = bodies.item(iBodies)
                        bname = body.name
                        # console.log("STL Export Body '"+body+"' : Name '"+name+"'");

                        # Create a clean filename
                        exportFilename = _exportFolder + '/' + _app.activeDocument.name + '_' + bname + '_' + parentParamNameVals + '_' + str(val).replace('.', '_') + '.stl'

                        stlOptions = exportMgr.createSTLExportOptions(body, exportFilename)
                        #stlOptions.isBinaryFormat = True
                        #stlOptions.meshRefinement = adsk.fusion.MeshRefinementSettings.MeshRefinementHigh
                        resExport = exportMgr.execute(stlOptions)
                else:
                    stlOptions = exportMgr.createSTLExportOptions(des.rootComponent, exportFilename + '.stl')
                    #stlOptions.isBinaryFormat = True
                    #stlOptions.meshRefinement = adsk.fusion.MeshRefinementSettings.MeshRefinementHigh
                    resExport = exportMgr.execute(stlOptions)

        else: # Not a leaf node so iterate downward
            for paramIndex2 in range(paramIndex + 1, len(paramValues)):
                updateParams(paraParams, paramIndex2, paramValues, False, operation)

def doParaParam(operation, userParamName, startValue, endValue, stepValue, exportSTLPerBody, restoreValues):
    try:

        global _exportFolder

        des = adsk.fusion.Design.cast(_app.activeProduct)

        paraParams = []

        # Use param CSV file?
        if userParamName == '':
            paraParams = getCSVFile()
        else:
            # Add single param row to the list.
            paraParams.append([userParamName, startValue, endValue, stepValue])

        if len(paraParams) == 0:
            return
        
        # If operation is an export then prompt for folder location and then
        # generate the filename prefix used for the exports.
        if operation != _OPERATIONS[_OP_LOOP_ONLY]:

            # Prompt for the folder to use for the exports.
            folderDlg = _ui.createFolderDialog()
            folderDlg.title = 'Select Export Folder'
            if _exportFolder != '':
                folderDlg.initialDirectory = _exportFolder
            if folderDlg.showDialog() != adsk.core.DialogResults.DialogOK:
                return

            # Save the current folder values as attributes.
            attribs = des.attributes
            _exportFolder = folderDlg.folder
            attribs.add('ParaParam', 'exportFolder', _exportFolder)

        # Track current param value (expression) while iterating over all
        paramValues = {}

        # Get the current param values and also save them so we can restore later
        userParamValuesOriginal = {}
        for iParam in range(len(paraParams)):

            # Get the custom param info
            curParam = paraParams[iParam]
            curParamName = curParam[0]

            # Get the actual parameter to modify
            userParam = des.userParameters.itemByName(curParamName)
            if userParam is None:
                return

            userParamValuesOriginal[curParamName] = userParam.expression
            paramValues[curParamName] = userParam.expression

        # Now begin the param updates.  This is a recursive function which will
        # iterate over each param and update.  It's really just a way of doing
        # the following but for an arbitrary number of params:
        # for i in range(iCount)
        #   for j in range(jCount)
        #     for k in range(kCount)
        #       print(value(i,j,k))
        updateParams(paraParams, 0, paramValues, exportSTLPerBody, operation)

        # Restore original param values on finish?
        if restoreValues == True:
            # For each of the params we modified, restore the original value
            for K in userParamValuesOriginal:
                userParam = des.userParameters.itemByName(K)
                userParam.expression = userParamValuesOriginal[K]
 
        return
    
    except Exception as error:
        _ui.messageBox("ParaParam Failed : " + str(error)) 
        return None
