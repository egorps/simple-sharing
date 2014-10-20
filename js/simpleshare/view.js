// Copyright 2014 Google Inc. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.


/**
 * View for the Zip Extractor.
 * Depends on:
 *  simpleshare.Model
 *  simpleshare.Presenter
 *  simpleshare.Table
 *  simpleshare.PickerManager
 */

simpleshare.View = function(presenter, pickerManager) {
    this.model_ = null;
    this.presenter_ = presenter;
    this.table_ = null;
    this.pickerManager_ = pickerManager;

    this.isInitialized_ = false;

    this.localFileInputEl = null;
    this.zipDropAreaDiv = null;

    this.chooseFileFromDriveButton = null;
    this.shareFilesButton = null;

    this.fileTableDiv = null;
    this.fileTableHeaderEl = null;

    this.primaryStatusSpinner = null;
    this.primaryStatusProgress = null;
    this.primaryStatusText = null;
    this.primaryStatusProgressBar = null;
};


simpleshare.View.APP_NAME_ = 'Simple Share';


/**
 * Called only after DOM has loaded, since attaching to elements.
 */
simpleshare.View.prototype.init = function() {
    if (this.isInitialized_) {
        throw ('Error: View already initialized.');
    }

    this.model_ = this.presenter_.model_;

    this.attachDom_();
    this.attachListeners_();
    this.isInitialized_ = true;
};


simpleshare.View.prototype.attachDom_ = function() {
    this.authButton = document.getElementById('authorizeButton');

    this.fileDetailsDiv = document.getElementById('fileDetailsDiv');
    this.fileDetails = document.getElementById('fileDetails');
    this.fileIcon = document.getElementById('fileIcon');
    this.chooseFileFromDriveButton = document.getElementById('chooseFromDriveButton');
    this.shareFilesButton = document.getElementById('shareFilesButton');

    this.fileTableDiv = document.getElementById('fileTableDiv');

    this.primaryStatus = document.getElementById('primaryStatus');
    this.primaryStatusSpinner = document.getElementById('primaryStatusSpinner');
    this.primaryStatusProgress = document.getElementById('primaryStatusProgress');
    this.primaryStatusText = document.getElementById('primaryStatusText');
    this.primaryStatusProgressBar = document.getElementById('primaryStatusProgressBar');

};


simpleshare.View.prototype.attachListeners_ = function() {
    this.chooseFileFromDriveButton.onclick = simpleshare.util.bindFn(this.chooseFileFromDriveButtonClick_, this);
    this.authButton.onclick = simpleshare.util.bindFn(this.handleAuthButtonClick_, this);
    this.shareFilesButton.onclick = simpleshare.util.bindFn(this.handleShareFilesButtonClick_, this);
};


simpleshare.View.prototype.isSelected = function(entry) {
    return this.table_.isChecked(entry);
};


simpleshare.View.prototype.updateState = function(newState, oldState, opt_data) {
    if (!this.isInitialized_) {
        return;
    }

    switch (newState) {
        case simpleshare.state.SessionState.API_LOADED:
            break;

        case simpleshare.state.SessionState.READ_URL_STATE:
            break;

        case simpleshare.state.SessionState.AUTH_PENDING_AUTO:
            this.updatePrimaryStatus_(true, true, 'Checking authorization...');
            break;

        case simpleshare.state.SessionState.AUTH_PENDING_USER:
            this.authButton.disabled = true;
            this.updatePrimaryStatus_(true, true, 'Authorization pending... (Click "Accept" in ' +
            'the popup window to authorize Simple Share App to use Google Drive.)');
            break;

        case simpleshare.state.SessionState.AUTH_SUCCESS:
            this.authButton.disabled = true;
            this.showEl_(this.authButton, false);
            break;

        case simpleshare.state.SessionState.AUTH_ERROR:
        case simpleshare.state.SessionState.AUTH_REQUIRED:
            this.updatePrimaryStatus_(
                true, false, 'Please authorize Simple Sharing App to access to Google Drive. ' +
                '(Click "Authorize" below.)');
            this.authButton.disabled = false;
            this.showEl_(this.authButton, true);
            break;

        case simpleshare.state.SessionState.INIT:
            break;

        case simpleshare.state.SessionState.NEW_SESSION:
            this.setupForNewSession_();
            break;
        default:
            throw('Unexpected state: ' + newState);   
    }
};


simpleshare.View.prototype.updateEntryIconForState_ = function(entry, complete) {
    // TODO: Additional icons for error, abort, etc.
    this.table_.updateEntryIcon(entry, undefined /* iconUrl */, !complete /* showSpinner */);      
};


simpleshare.View.prototype.handleSessionProgress = function(current, total) {
    // TODO: Consider consolidating these methods.
    var percent = (100 * (current / total));    
    this.updatePrimaryStatus_(true, false, '', true, true, Math.round(percent));
};


simpleshare.View.prototype.updatePageTitle = function(filename) {
    document.title = filename ? 
        filename + ' - ' + simpleshare.View.APP_NAME_ : 
        simpleshare.View.APP_NAME_;
};


simpleshare.View.prototype.updateUiForFileComplete = function(entry, openUrl, iconUrl) {
    if (openUrl) {
        this.table_.updateEntryLink(entry, openUrl);
    }
    
    // Clear the spinner icon and show either the icon for the uploaded file,
    // or a default icon.
    if (iconUrl) {
        this.table_.updateEntryIcon(entry, iconUrl);
    } else {
        this.updateEntryIconForState_(entry, true);
    }
};


simpleshare.View.prototype.updatePrimaryStatus_ = 
    function(show, showSpinner, text, skipTextUpdate, showProgress, progressPercent) {

    if (!skipTextUpdate) {
        this.primaryStatusText.innerHTML = text || '';
    }
    
    this.showEl_(this.primaryStatusProgress, show);
    this.showEl_(this.primaryStatusSpinner, showSpinner);

    if (showProgress) {
        this.primaryStatusProgressBar.style.width = "" + progressPercent + "%";
    }
    
    this.showEl_(this.primaryStatusProgress, !!showProgress);
};


simpleshare.View.prototype.setupForNewSession_ = function() {
    this.showEl_(this.shareFilesButton, false);
    this.showEl_(this.fileTableDiv, false);

    this.showEl_(this.chooseFileFromDriveButton, true);
    this.enableEl_(this.chooseFileFromDriveButton, true);

    this.updatePrimaryStatus_(true, false, 'Choose a file!');
};


simpleshare.View.prototype.chooseFileFromDriveButtonClick_ = function(e) {
    this.pickerManager_.show(
        simpleshare.util.PickerManager.PickerMode.FILE, 
        simpleshare.util.bindFn(this.handlePickerFileSelected_, this));
};


simpleshare.View.prototype.handlePickerFileSelected_ = function(file) {
    console.log('picker: ' + JSON.stringify(file));
    this.model_.setFile(file);
    this.fileDetails.innerText = this.model_.getName();
    this.fileIcon.src = this.model_.getIconUrl();
    this.showEl_(this.shareFilesButton, true);
    this.enableEl_(this.shareFilesButton, true);
    this.showEl_(this.fileDetailsDiv, true);
    this.enableEl_(this.fileDetailsDiv, true);
    this.showEl_(this.chooseFileFromDriveButton, false);
};


simpleshare.View.prototype.handleAuthButtonClick_ = function(e) {
    this.presenter_.VIEW__authRequested();   
};


simpleshare.View.prototype.showEl_ = function(el, show) {
    el.style.display = show ? '' : 'none';
};


simpleshare.View.prototype.enableEl_ = function(el, enable) {
    el.disabled = !enable;
};


simpleshare.View.prototype.handleShareFilesButtonClick_ = function(e) {
    this.presenter_.VIEW__shareFile(this.model_.getFileId());
};

