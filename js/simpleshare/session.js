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
 * Session for Simpleshare. Extension of the presenter.
 * Executes the model when requested.
 *
 */

simpleshare.Session = function(parentId, presenter, model, view, fileManager) {
    this.parentId_ = parentId;
    this.presenter_ = presenter;
    this.model_ = model;
    this.view_ = view;
    this.workQueue_ = new simpleshare.util.AsyncWorkQueue(simpleshare.Session.MAX_WORKQUEUE_WORKERS_);
    this.fileManager_ = fileManager;
    
    this.entryStateMap_ = {};
    this.entriesInProcessMap_ = {};
    
    this.totalSessionSize_ = 0;
    this.currentSessionProgress_ = 0;
    
    this.isClosed_ = false;
    this.isAborted_ = false;
    this.hasBeenRetried_ = false;
};

// TODO: Consider compatibility mode.
simpleshare.Session.MAX_WORKQUEUE_WORKERS_ = 2;

simpleshare.Session.TRANSFER_DECOMPRESS_MULTIPLIER_ = 3;
simpleshare.Session.ENTRY_OVERHEAD_BYTES_ = 20000;


/**
 * Sets the current session parent ID to the ID of the first parent
 * on the specified file.
 */
simpleshare.Session.prototype.updateParentIdByFile = function(file) {
  var parents = file.parents;
  if (parents && parents.length > 0) {
      var parent = parents[0];
      if (parent && parent.id) {
          this.parentId_ = parent.id;
      }
  }
};


simpleshare.Session.prototype.getParentId = function() {
    return this.parentId_;
};


simpleshare.Session.prototype.setParentId = function(parentId) {
    this.parentId_ = parentId;
};


simpleshare.Session.prototype.abort = function() {
    this.isAborted_ = true;
    this.workQueue_.stop();
    this.fileManager_.abortAllRequests();
    this.cancelAllUnstartedEntries_();
    this.checkForExtractionComplete_();
};


simpleshare.Session.prototype.close = function() {
    if (this.isClosed_) {
        throw('Error: Cannot close an already closed session.');
    }

    this.model_ = null;
    this.parentId_ = null;
    delete this.workQueue_;
    this.entryStateMap_ = {};
    this.entriesInProcessMap_ = {};
    this.fileManager_ = null;    
    this.totalSessionSize_ = 0;
    this.currentSessionProgress_ = 0;
    
    this.isClosed_ = true;
};


simpleshare.Session.prototype.hasBeenRetried = function() {
  return this.hasBeenRetried_;
};


simpleshare.Session.prototype.hasErrors = function() {
    var rootEntry = this.model_.getEntryTree();
    if (this.isErrorState_(rootEntry.state)) {
        return true;
    } else {
        return this.childEntriesHaveErrors_(rootEntry);
    }
};


simpleshare.Session.prototype.childEntriesHaveErrors_ = function(entry) {
    for (var entryKey in entry.children) {        
        var childEntry = entry.children[entryKey];
        if (this.isErrorState_(childEntry.state)) {
            return true;
        } else if (childEntry.directory && this.childEntriesHaveErrors_(childEntry)) {
            return true;
        }
    }
    return false;
};


simpleshare.Session.prototype.hasAuthErrors = function() {
    var rootEntry = this.model_.getEntryTree();
    if (this.entryHasAuthError_(rootEntry)) {
        return true;
    } else {
        return this.childEntriesHaveAuthErrors_(rootEntry);
    }
};


simpleshare.Session.prototype.childEntriesHaveAuthErrors_ = function(entry) {
    for (var entryKey in entry.children) {        
        var childEntry = entry.children[entryKey];
        if (this.entryHasAuthError_(childEntry)) {
            return true;
        } else if (childEntry.directory && this.childEntriesHaveAuthErrors_(childEntry)) {
            return true;
        }
    }
    return false;
};


simpleshare.Session.prototype.entryHasAuthError_ = function(entry) {
  return (entry.uploadError == driveapi.FileManager.ErrorType.AUTH_ERROR) && 
      (entry.state == simpleshare.state.EntryState.UPLOAD_ERROR);  
};


simpleshare.Session.prototype.execute = function(isForRetry) {
    if (this.isClosed_) {
        throw('Error: Cannot execute a closed session.');
    }
    
    if (isForRetry) {
      this.hasBeenRetried_ = true;
    }
    
    var rootEntry = this.model_.getEntryTree();
    
    // QUEUE or SKIP entries as determined by check state.
    this.queueEntry_(rootEntry);
    this.queueEntryChildren_(rootEntry);
    
    this.currentSessionProgress_ = 0;
    this.totalSessionSize_ = this.computeSessionSize_(rootEntry);
    
    if (this.isUploadableState_(rootEntry.state)) {
        // First create the new parent into which the ZIP file contents will be extracted.
        this.workQueue_.enqueue(this.generateWorkItem_(rootEntry, this.parentId_));
        this.updateEntryState_(rootEntry, simpleshare.state.EntryState.PENDING);

        // Run this first parent folder creation immediately. Callbacks will upload children.
        // No children can be uploaded until the root folder is first created.
        this.runWorkQueue_();
    } else {
        // Root folder skipped; process children.
        this.processEntryTreeChildren_(rootEntry, this.parentId_, isForRetry);
    }
};


simpleshare.Session.prototype.processEntryTreeChildren_ = function(entryTree, parentId, isForRetry) {        
    // Queue work items (uploads) depth-first in the entry tree.
    for (var entryKey in entryTree.children) {        
        var entry = entryTree.children[entryKey];

        if (this.isAborted_) {
            this.updateEntryState_(entry, simpleshare.state.EntryState.CANCELED);
        } else {
            if (this.isUploadableState_(entry.state)) {        
                this.workQueue_.enqueue(this.generateWorkItem_(entry, parentId));
                this.updateEntryState_(entry, simpleshare.state.EntryState.PENDING);
            } else if (!!isForRetry && entry.directory && entry.state == simpleshare.state.EntryState.UPLOAD_COMPLETE) {
                // If an item is a directory, and it's already been uploaded, but this is for retry,
                // failed child items may exist. Process recursively without uploading the current entry.
                // The parent ID for children is this entry's associated drive ID.
                this.processEntryTreeChildren_(entry, entry.folder.id, isForRetry);
            }
        }
    }
    
    if (!this.isAborted_) {
        this.runWorkQueue_();   
    }
};


simpleshare.Session.prototype.computeSessionSize_ = function(rootEntry) {
    return this.getEntrySize_(rootEntry) + this.computeChildEntrySize_(rootEntry);
};


simpleshare.Session.prototype.computeChildEntrySize_ = function(entry) {
    var cumulativeSize = 0;
    for (var entryKey in entry.children) {        
        var childEntry = entry.children[entryKey];
        
        var currentSize = this.getEntrySize_(childEntry);
        var childrenSize = childEntry.directory ? this.computeChildEntrySize_(childEntry) : 0;
        cumulativeSize += currentSize + childrenSize;
    }
    return cumulativeSize;
};


simpleshare.Session.prototype.getEntrySize_ = function(entry) {
    if (!this.isUploadableState_(entry.state)) {
        return 0;
    } else {        
        // uncompressed + N * compressed + session overhead bytes
        var fileSize = entry.directory ? 
            0 : 
            (entry.compressedSize + simpleshare.Session.TRANSFER_DECOMPRESS_MULTIPLIER_ * entry.uncompressedSize);

        return fileSize + simpleshare.Session.ENTRY_OVERHEAD_BYTES_;
    }
};


simpleshare.Session.prototype.queueEntry_ = function(entry) {
    // Only queue entries that are in their default (initialized) state.
    // Leave other states alone, so concurrent calls of execute() result in retry.
    if (entry.state == simpleshare.state.EntryState.DEFAULT) {
        var targetState = this.view_.isSelected(entry) ? 
            simpleshare.state.EntryState.QUEUED : 
            simpleshare.state.EntryState.SKIPPED;
        
        this.updateEntryState_(entry, targetState);
    }
};


simpleshare.Session.prototype.queueEntryChildren_ = function(entry) {
    for (var entryKey in entry.children) {        
        var childEntry = entry.children[entryKey];
        this.queueEntry_(childEntry);
        if (childEntry.directory) {
            this.queueEntryChildren_(childEntry);
        }
    }
};


simpleshare.Session.prototype.cancelAllUnstartedEntries_ = function() {
    var rootEntry = this.model_.getEntryTree();
    this.cancelUnstartedEntry_(rootEntry);
    this.cancelUnstartedChildEntries_(rootEntry);
};


simpleshare.Session.prototype.cancelUnstartedEntry_ = function(entry) {
    // Here, in-progress uploads will be aborted, other files will be canceled; don't cancel
    // 'finishing' or 'uploading' states.
    if (!this.isTerminalState_(entry.state) && !this.isInProgressState_(entry.state)) {    
        this.updateEntryState_(entry, simpleshare.state.EntryState.CANCELED);
    }
};


simpleshare.Session.prototype.cancelUnstartedChildEntries_ = function(entry) {
    for (var entryKey in entry.children) {        
        var childEntry = entry.children[entryKey];
        this.cancelUnstartedEntry_(childEntry);
        if (childEntry.directory) {
            this.cancelUnstartedChildEntries_(childEntry);
        }
    }
};


simpleshare.Session.prototype.runWorkQueue_ = function() {
    this.workQueue_.run(simpleshare.util.bindFn(this.workQueueExecutionComplete_, this));
};


simpleshare.Session.prototype.updateEntryState_ = function(entry, newState) {
    this.updateEntryStateMap_(entry, newState);
    this.presenter_.updateEntryState(entry, newState);
};


simpleshare.Session.prototype.incrementSessionProgress_ = function(entry, increment) {
    if (this.isAborted_) {
        return;
    }    
    
    this.currentSessionProgress_ += increment;
    this.view_.handleSessionProgress(this.currentSessionProgress_, this.totalSessionSize_);
};


simpleshare.Session.prototype.updateEntryStateMap_ = function(entry, newState) {
    var oldState = entry.state;
    var path = entry.path;

    // Add entry to the map for the new state.
    var entryMapForNewState = this.entryStateMap_[newState];
    if (!entryMapForNewState) {
        entryMapForNewState = {};
        this.entryStateMap_[newState] = entryMapForNewState;
    }
    entryMapForNewState[path] = entry;
    
    // Remove entry from the map of the old state.
    var entryMapForOldState = this.entryStateMap_[oldState];
    if (entryMapForOldState) {
        if (entryMapForOldState.hasOwnProperty(path)) {
            delete entryMapForOldState[path];
        }
    }
    
    if (this.isTerminalState_(newState)) {
        delete this.entriesInProcessMap_[path];
    } else {
        this.entriesInProcessMap_[path] = entry;
    }
};


simpleshare.Session.prototype.areAllStatesTerminal_ = function() {
    return Object.keys(this.entriesInProcessMap_).length === 0;
};


simpleshare.Session.prototype.isTerminalState_ = function(state) {
    return state == simpleshare.state.EntryState.UPLOAD_COMPLETE || 
        state == simpleshare.state.EntryState.UPLOAD_ERROR ||
        state == simpleshare.state.EntryState.SKIPPED || 
        state == simpleshare.state.EntryState.CANCELED ||
        state == simpleshare.state.EntryState.QUEUED_PENDING_RETRY ||
        state == simpleshare.state.EntryState.UPLOAD_ABORTED;
};


simpleshare.Session.prototype.isUploadableState_ = function(state) {
    return state == simpleshare.state.EntryState.QUEUED || 
        state == simpleshare.state.EntryState.QUEUED_PENDING_RETRY ||
        state == simpleshare.state.EntryState.UPLOAD_ERROR;
};


simpleshare.Session.prototype.isErrorState_ = function(state) {
    return state == simpleshare.state.EntryState.UPLOAD_ERROR || 
        state == simpleshare.state.EntryState.DECOMPRESSION_ERROR;
};


simpleshare.Session.prototype.isInProgressState_ = function(state) {
    return state == simpleshare.state.EntryState.BEGIN_UPLOAD || 
        state == simpleshare.state.EntryState.UPLOAD_PROGRESS ||
        state == simpleshare.state.EntryState.UPLOAD_ALL_BYTES_TRANSFERRED;
};


simpleshare.Session.prototype.generateWorkItem_ = function(entry, parentId) {
    entry.parentId = parentId;
    var method = entry.directory ? this.processFolder_ : this.processFile_;
    return simpleshare.util.bindFn(method, this, entry, parentId);
};


simpleshare.Session.prototype.processFolder_ = function(entry, parentId, workerCompleteCallback) {            
    // Insert the folder, process state updates when done, then recurse to resume process of the
    // children.
    if (this.isAborted_) {
        this.updateEntryState_(entry, simpleshare.state.EntryState.CANCELED);
        return;
    }
    
    // Reset any previous progress values.
    entry.uploadPrev = 0;
    entry.uploadCurrent = 0;
    entry.uploadTotal = 0;    
    
    this.updateEntryState_(entry, simpleshare.state.EntryState.BEGIN_UPLOAD);
    
    var callbacks = this.fileManager_.generateCallbacks(
        simpleshare.util.bindFn(
            this.folderInsertComplete_, 
            this,
            entry,
            workerCompleteCallback,
            simpleshare.util.bindFn(this.processEntryTreeChildren_, this, entry)),
        simpleshare.util.bindFn(this.folderInsertError_, this, entry, workerCompleteCallback),
        undefined /* progressCallback */,
        simpleshare.util.bindFn(this.folderInsertAborted_, this, entry, workerCompleteCallback));

    this.fileManager_.insertFolder(entry.name, parentId, callbacks);
};


simpleshare.Session.prototype.processFile_ = function(entry, parentId, workerCompleteCallback) {
    if (this.isAborted_) {
        this.updateEntryState_(entry, simpleshare.state.EntryState.CANCELED);
        return;
    }
    
    // Reset any previous progrss values.
    entry.decompressionPrev = 0;
    entry.decompressionCurrent = 0;
    entry.decompressionTotal = 0;
    entry.uploadPrev = 0;
    entry.uploadCurrent = 0;
    entry.uploadTotal = 0;

    this.updateEntryState_(entry, simpleshare.state.EntryState.BEGIN_DECOMPRESSION);
        
    // TODO: Consider separating decompression from ZIP upload.
    // TODO: Deal with decompression errors in getData(), e.g., via try/catch.
    
    // Decompress the blob, upload the blob, process state updates when done.
    entry.getData(
        new zip.BlobWriter(), 
        simpleshare.util.bindFn(this.decompressionComplete_, this, entry, parentId, workerCompleteCallback),
        simpleshare.util.bindFn(this.handleDecompressionProgress_, this, entry),
        true /* checkCrc32 */);            
};


simpleshare.Session.prototype.handleDecompressionProgress_ = function(entry, current, total) {
    if (this.isAborted_) {
        return;
    }
    
    entry.decompressionPrev = entry.decompressionCurrent ? entry.decompressionCurrent : 0;
    entry.decompressionCurrent = current;
    entry.decompressionTotal = total;
    this.updateEntryState_(entry, simpleshare.state.EntryState.DECOMPRESSION_PROGRESS);

    var progressStep = entry.decompressionCurrent - entry.decompressionPrev;
    this.incrementSessionProgress_(entry, progressStep);
};


simpleshare.Session.prototype.decompressionComplete_ = function(entry, parentId, workerCompleteCallback, blob) {
    if (this.isAborted_) {
        this.updateEntryState_(entry, simpleshare.state.EntryState.CANCELED);
        this.checkForExtractionComplete_();
        return;
    }
    
    this.updateEntryState_(entry, simpleshare.state.EntryState.DECOMPRESSION_COMPLETE);           
    this.uploadFile_(entry, parentId, blob, workerCompleteCallback);
};


simpleshare.Session.prototype.uploadFile_ = function(entry, parentId, blob, workerCompleteCallback) {
    if (this.isAborted_) {
        this.updateEntryState_(entry, simpleshare.state.EntryState.CANCELED);
        this.checkForExtractionComplete_();
        return;
    }
    
    this.updateEntryState_(entry, simpleshare.state.EntryState.BEGIN_UPLOAD);
    
    var callbacks = this.fileManager_.generateCallbacks(
        simpleshare.util.bindFn(this.fileUploadComplete_, this, entry, workerCompleteCallback),
        simpleshare.util.bindFn(this.fileUploadError_, this, entry, workerCompleteCallback),
        simpleshare.util.bindFn(this.fileUploadProgress_, this, entry),
        simpleshare.util.bindFn(this.fileUploadAborted_, this, entry, workerCompleteCallback));
        
    this.fileManager_.insertBlob(blob, entry.name, parentId, callbacks);
};


simpleshare.Session.prototype.fileUploadComplete_ = function(entry, workerCompleteCallback, uploadedFile) {
    entry.file = uploadedFile;
    this.updateEntryState_(entry, simpleshare.state.EntryState.UPLOAD_COMPLETE);    
    this.view_.updateUiForFileComplete(entry, uploadedFile.alternateLink, uploadedFile.iconLink);    
    this.incrementSessionProgress_(entry, simpleshare.Session.ENTRY_OVERHEAD_BYTES_);
        
    // Worker complete callback to be done only after all state updates have been performed.
    // Worker complete may trigger 'session done' which performs actions that are dependent on state.
    workerCompleteCallback();
    
    if (this.isAborted_) {
        this.checkForExtractionComplete_();
    }
};


simpleshare.Session.prototype.fileUploadError_ = function(entry, workerCompleteCallback, error, message) {
    this.incrementSessionProgress_(entry, simpleshare.Session.ENTRY_OVERHEAD_BYTES_);

    entry.uploadError = error;
    entry.message = message;
    this.updateEntryState_(entry, simpleshare.state.EntryState.UPLOAD_ERROR, error);
    workerCompleteCallback();    
    this.checkForExtractionComplete_();
};


simpleshare.Session.prototype.fileUploadAborted_ = function(entry, workerCompleteCallback, message) {
    this.incrementSessionProgress_(entry, simpleshare.Session.ENTRY_OVERHEAD_BYTES_);
  
    entry.aborted = true;
    entry.message = message;
    this.updateEntryState_(entry, simpleshare.state.EntryState.UPLOAD_ABORTED, message);
    workerCompleteCallback();
    this.checkForExtractionComplete_();
};


simpleshare.Session.prototype.fileUploadProgress_ = function(entry, current, total) {
    if (this.isAborted_) {
        return;
    }
    
    entry.uploadPrev = entry.uploadCurrent ? entry.uploadCurrent : 0;
    entry.uploadCurrent = current;
    entry.uploadTotal = total;    
    this.updateEntryState_(entry, simpleshare.state.EntryState.UPLOAD_PROGRESS);
            
    if (current === total) {
        this.updateEntryState_(entry, simpleshare.state.EntryState.UPLOAD_ALL_BYTES_TRANSFERRED);
    }

    // Account for actual XHR overhead of content exceeding binary content size due to
    // protocol overhead.
    var progressStepRaw = entry.uploadCurrent - entry.uploadPrev;
    var progressStepNormalized = (entry.uncompressedSize / total) * progressStepRaw;
    this.incrementSessionProgress_(entry, simpleshare.Session.TRANSFER_DECOMPRESS_MULTIPLIER_ * progressStepNormalized);
};


simpleshare.Session.prototype.folderInsertComplete_ = function(entry, workerCompleteCallback, resultCallback, createdFolder) {
    entry.folder = createdFolder;
    this.updateEntryState_(entry, simpleshare.state.EntryState.UPLOAD_COMPLETE);
    this.view_.updateUiForFileComplete(entry, simpleshare.util.createDriveFolderLink(createdFolder.id));    
    this.incrementSessionProgress_(entry, simpleshare.Session.ENTRY_OVERHEAD_BYTES_);
    
    resultCallback(createdFolder.id);        
    
    workerCompleteCallback();
    
    if (this.isAborted_) {
        this.checkForExtractionComplete_();
    }        
};


simpleshare.Session.prototype.folderInsertError_ = function(entry, workerCompleteCallback, error, message) {
    this.incrementSessionProgress_(entry, simpleshare.Session.ENTRY_OVERHEAD_BYTES_);
    
    entry.uploadError = error;
    entry.message = message;
    this.updateEntryState_(entry, simpleshare.state.EntryState.UPLOAD_ERROR, message);
    
    // If a folder had an error, put all child items in a "Queued pending error" state
    // such that they will be uploaded on a retry, unless they were skipped by the user.
    this.setAllChildEntriesQueuedPendingRetry_(entry);
    
    workerCompleteCallback();

    // A folder error may place children in a terminal state, so the extraction may be done.
    this.checkForExtractionComplete_();
};


simpleshare.Session.prototype.folderInsertAborted_ = function(entry, workerCompleteCallback, message) {
    this.incrementSessionProgress_(entry, simpleshare.Session.ENTRY_OVERHEAD_BYTES_);
    
    entry.aborted = true;
    entry.message = message;
    this.updateEntryState_(entry, simpleshare.state.EntryState.UPLOAD_ABORTED, message);
    
    // If a folder was aborted an error, cancel all child items.
    this.cancelAllChildEntries_(entry);
    
    workerCompleteCallback();
    
    // A folder abort may cancel queued children, so the extraction may be done.
    this.checkForExtractionComplete_();
};


simpleshare.Session.prototype.cancelAllChildEntries_ = function(entry) {
    for (var entryKey in entry.children) {        
        var childEntry = entry.children[entryKey];
        this.updateEntryState_(childEntry, simpleshare.state.EntryState.CANCELED);
        if (childEntry.directory) {
            this.cancelAllChildEntries_(childEntry);
        }
    }
};


simpleshare.Session.prototype.setAllChildEntriesQueuedPendingRetry_ = function(entry) {
    for (var entryKey in entry.children) {        
        var childEntry = entry.children[entryKey];
        
        if (childEntry.state != simpleshare.state.EntryState.SKIPPED) {
            this.updateEntryState_(childEntry, simpleshare.state.EntryState.QUEUED_PENDING_RETRY);
            this.incrementSessionProgress_(childEntry, simpleshare.Session.ENTRY_OVERHEAD_BYTES_);
        
            if (childEntry.directory) {
                this.setAllChildEntriesQueuedPendingRetry_(childEntry);
            }
        }
    }
};


simpleshare.Session.prototype.workQueueExecutionComplete_ = function() {
    this.checkForExtractionComplete_();
};


simpleshare.Session.prototype.checkForExtractionComplete_ = function() {
    if (this.areAllStatesTerminal_()) {
        if (this.isAborted_) {
            this.presenter_.SESSION__extractionCanceled();
        } else {
            this.presenter_.SESSION__extractionComplete();
        }
    }
};
