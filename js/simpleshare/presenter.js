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
 * Simple Share Presenter. Controls flow of the app, updates the view.
 *
 * Depends on:
 *   simpleshare.state.SessionState
 *   simpleshare.util
 *   simpleshare.Model
 *   simpleshare.View
 *   driveapi.AuthManager
 *   driveapi.UrilStateParser
 *   driveApi.FileManager
 */

simpleshare.Presenter = function(appConfig) {
    this.appConfig_ = appConfig;

    this.model_ = new simpleshare.Model();
    this.urlStateParser_ = new driveapi.UrlStateParser();
    this.authManager_ = new driveapi.AuthManager(appConfig);
    this.fileManager_ = new driveapi.FileManager(this.authManager_);

    var pickerManager = new simpleshare.util.PickerManager(appConfig, this.authManager_);
    this.view_ = new simpleshare.View(this, pickerManager);

    this.state_ = simpleshare.state.SessionState.DEFAULT;

    this.htmlBodyLoaded_ = false;
    this.apiLoaded_ = false;
    this.sharingLoaded_ = false;
    this.currentSession_ = null;
};


/**
 * Flag indicating whether the app is in DEBUG mode. If set, authorization will be skipped,
 * and the app will have limited local functionality for ZIP processing, download, etc.
 */
simpleshare.Presenter.IS_DEBUG_ = false;


/**
 * Handles when body onload() event is fired in the main HTML page.
 */
simpleshare.Presenter.prototype.onHtmlBodyLoaded = function() {
    this.htmlBodyLoaded_ = true;
    this.view_.init();

    this.parseUrlState_();

    if (this.apiLoaded_) {
        this.authorize_(true /* isInvokedByApp */);
    }

    if (simpleshare.Presenter.IS_DEBUG_) {
        this.processRequestFromState_();
    }
};


/**
 * Handles when the Google JS API has loaded.
 */
simpleshare.Presenter.prototype.onGapiClientLoaded = function() {
    this.apiLoaded_ = true;
    this.setState_(simpleshare.state.SessionState.API_LOADED);

    this.parseUrlState_();

    if (this.htmlBodyLoaded_) {
        this.authorize_(true /* isInvokedByApp */);
    }

    // Load sharing widget.
    console.log('loading the sharing widget');
};


simpleshare.Presenter.prototype.parseUrlState_ = function(e) {
  if (!this.urlStateParser_.isParsed()) {
    this.setState_(simpleshare.state.SessionState.READ_URL_STATE);
    this.urlStateParser_.parseState();
  }
};


simpleshare.Presenter.prototype.sharingLoadComplete_ = function() {
    console.log('loaded the sharing widget');
    var sharingDialog = new gapi.drive.share.ShareClient(this.appConfig_.getAppId());
    sharingDialog.setItemIds([this.id]);
    sharingDialog.showSettingsDialog();
};


// TODO: Should this be in the view?
simpleshare.Presenter.prototype.showSharingDialog_ = function(id) {
    this.id = id;
    gapi.load('drive-share', simpleshare.util.bindFn(this.sharingLoadComplete_, this));
};

simpleshare.Presenter.prototype.init = function() {
  // First initialization of the view.
  // TODO: This may be redundant with construction.
  this.setState_(simpleshare.state.SessionState.INIT);
};


simpleshare.Presenter.prototype.setState_ = function(newState, opt_data) {
    var oldState = this.state_;
    this.state_ = newState;
    this.view_.updateState(newState, oldState, opt_data);
};


simpleshare.Presenter.prototype.authorize_ = function(isInvokedByApp) {
    if (simpleshare.Presenter.IS_DEBUG_) {
        return;
    }

    var state = isInvokedByApp ?
        simpleshare.state.SessionState.AUTH_PENDING_AUTO :
        simpleshare.state.SessionState.AUTH_PENDING_USER;
    this.setState_(state);

    this.authManager_.authorize(
        isInvokedByApp,
        simpleshare.util.bindFn(this.handleAuthResult_, this),
        this.urlStateParser_.getUserId());
};


simpleshare.Presenter.prototype.handleAuthResult_ = function(authResult) {
    if (authResult) {
        if (authResult.error) {
            this.setState_(simpleshare.state.SessionState.AUTH_ERROR, authResult.error);
        } else {
            this.setState_(simpleshare.state.SessionState.AUTH_SUCCESS);
            this.processRequestFromState_();
        }
    } else {
        this.setState_(simpleshare.state.SessionState.AUTH_REQUIRED);
    }
};


simpleshare.Presenter.prototype.processRequestFromState_ = function() {
   if (this.urlStateParser_.isForOpen()) {
        // Download the file, read the ZIP, update UI.
        this.downloadFileById_(this.urlStateParser_.getFileId());
    } else {
        // Create New scenario, launched in zero state; setup new session UI.
        this.startNewSession_();
    }
};


simpleshare.Presenter.prototype.startNewSession_ = function() {
  this.view_.updatePageTitle();
  this.setState_(simpleshare.state.SessionState.NEW_SESSION);
};

simpleshare.Presenter.prototype.initModel_ = function(filename, blob) {
    this.view_.updatePageTitle(filename);
    this.setState_(simpleshare.state.SessionState.ZIP_READING);
    this.model_.setFilename(filename);

    this.zipReader_.read(
        blob,
        simpleshare.util.bindFn(this.zipReadSuccess_, this),
        simpleshare.util.bindFn(this.zipReadError_, this));
};


simpleshare.Presenter.prototype.zipReadError_ = function(err) {
    // This is also called on a ZIP decompression error, including failed CRC checks.
    this.setState_(simpleshare.state.SessionState.ZIP_READ_ERROR, err);
};


simpleshare.Presenter.prototype.zipReadSuccess_ = function(entries) {
    this.setState_(simpleshare.state.SessionState.MODEL_BUILDING);
    this.model_.build(entries, simpleshare.util.bindFn(this.modelBuildComplete_, this));
};


simpleshare.Presenter.prototype.modelBuildComplete_ = function() {
    // TODO: Verify that we need to pass the model in this way.
    this.setState_(simpleshare.state.SessionState.MODEL_BUILT, this.model_);
    this.setState_(
        simpleshare.state.SessionState.RENDER_ZIP_UI,
        simpleshare.util.bindFn(this.uiRenderComplete_, this));
};


simpleshare.Presenter.prototype.uiRenderComplete_ = function() {
    this.setState_(simpleshare.state.SessionState.PENDING_USER_INPUT);
};


simpleshare.Presenter.prototype.reset_ = function() {
    if (this.currentSession_) {
        this.currentSession_.close();
        this.currentSession_ = null;
        this.model_.clear();
    }
};

simpleshare.Presenter.prototype.VIEW__shareFile = function(fileId) {
  this.showSharingDialog_(fileId);
};
simpleshare.Presenter.prototype.VIEW__authRequested = function() {
    this.authorize_(false /* isInvokedByApp */);
};


