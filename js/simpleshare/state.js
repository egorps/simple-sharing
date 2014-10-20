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
 * State enums
 */


/**
 * States for the overall session state.
 */
simpleshare.state.SessionState = {
  DEFAULT: 'default', // initial uninitialized state.
  INIT: 'init', // After presenter has been created
  NEW_SESSION: 'newSession', // app launched zero-state
  APP_CREATE: 'appCreate', // While the app is being instantiated.
  APP_CREATED: 'appCreated', // Once the app is instantiated.
  APP_INIT: 'appInit', // While the app is initializing (auth not yet invoked)
  AUTH_PENDING_AUTO: 'authPendingAuto', // Automatic ('immediate') auth call was made at app startup.
  AUTH_PENDING_USER: 'authPendingUser', // User-initiated (non-'immediate') auth call was made as a result of clicking "AUTHORIZE".
  AUTH_REQUIRED: 'authRequired', // when auth call has returned, but auth is still required.
  AUTH_SUCCESS: 'authSuccess', // when auth call has returned, and the client is authorized.
  AUTH_ERROR: 'authError', // when auth call has returned when an error
  MODEL_BUILDING: 'modelBuilding', // when building the model.
  MODEL_BUILT: 'modelBuilt', // when building the model.
  READ_URL_STATE: 'readUrlState', // When reading the URL state.
  API_LOADED: 'apiLoaded', // When the API script has completed loading.
  PENDING_USER_INPUT: 'pendingUserInput' // waiting on UI, pending session
};