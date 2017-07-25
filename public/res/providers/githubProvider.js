define([
	"underscore",
	"utils",
	"classes/Provider",
	"settings",
	"eventMgr",
 	"fileSystem",
	 "fileMgr",
	 "storage",
	"helpers/githubHelper"
], function(_, utils, Provider, settings, eventMgr, fileSystem, fileMgr, storage, githubHelper) {


  


	var githubProvider = new Provider("github", "GitHub");
	githubProvider.publishPreferencesInputIds = [
		"github-repo",
		"github-branch"
	];

	

	githubProvider.editorSharingAttributes = [
		"username",
        "repository",
		"branch",
		"path"
    ];


	githubProvider.generateTitleFromAttributes = function(attributes) {
		var result = [
			attributes.username,
			attributes.repository,
			attributes.branch,
			attributes.path
		];
		return result.join('/');
	};

	githubProvider.generateSyncIndex = function(attributes) {
		var result = [
			"GITHUB_PROVIDER",
			attributes.username,
			attributes.repository,
			attributes.branch,
			attributes.path
		];
		return result.join('/');
	};


	githubProvider.samePublishLocation = function(attr1, attr2) {
		return attr1.username == attr2.username &&
			   attr1.repository == attr2.repository &&
			   attr1.branch == attr2.branch &&
			   attr1.path == attr2.path;
	};


	githubProvider.getPublishLocationLink = function(attributes) {
		var result = [
			'https://github.com',
			attributes.username,
			attributes.repository,
			'blob',
			attributes.branch
		];
		return result.concat(attributes.path.split('/').map(encodeURIComponent)).join('/');
	};

	githubProvider.publish = function(publishAttributes, frontMatter, title, content, callback) {
		var commitMsg = settings.commitMsg;
		githubHelper.upload(publishAttributes.repository, publishAttributes.username, publishAttributes.branch, publishAttributes.path, content, commitMsg, function(err, username) {
			publishAttributes.username = username;
			callback(err);
		});
	};

	githubProvider.read = function(importParameters, callback) {
		githubHelper.read(importParameters.username, importParameters.repository, importParameters.branch, importParameters.path, function(err, username, content, sha) {
			if (err === undefined) {
				callback(content, sha);
 			} else {
 				callback("");
 			}
 		});
	}



	githubProvider.importPrivate = function(importParameters, callback) {
		var fileDesc = null;

		//lets never overwrite an existing file with this method. We can provide a way to clobber and reimport
		utils.retrieveIndexArray("file.list").forEach(function(fileIndex) {
			var existingPublishIndex = _(fileSystem[fileIndex].publishLocations).find(function(filePublishAttributes) {
				return githubProvider.samePublishLocation(importParameters, filePublishAttributes)
			})

			if (existingPublishIndex) {
				fileDesc = fileSystem[fileIndex];
			}
		});

		if (fileDesc != null) {
			function overwrite() {
				githubProvider.read(importParameters, function(content) {
					eventMgr.onContentChanged(fileDesc, content);
					fileMgr.selectFile(fileDesc);
					callback();
				});
			}
			function keep() {
				fileMgr.selectFile(fileDesc);
				callback();
			}
			utils.overwriteConfirm(overwrite, keep);

		} else {
			githubProvider.read(importParameters, function(content,sha) {
				fileDesc = fileMgr.createFile(githubProvider.generateTitleFromAttributes(importParameters), content);
				importParameters.provider = githubProvider;
				importParameters.format = "markdown";
				importParameters.sha = sha;
				var publishIndex;
				do {
					publishIndex = "publish." + utils.id();
				} while(_.has(storage, publishIndex));
				importParameters.publishIndex = publishIndex;
				fileDesc.addPublishLocation(importParameters);
				eventMgr.onContentChanged(fileDesc, content);
				fileMgr.selectFile(fileDesc);
				callback();
			});
		}
	};


	githubProvider.newPublishAttributes = function(event) {
		var publishAttributes = {};
		publishAttributes.repository = utils.getInputTextValue("#input-publish-github-repo", event);
		publishAttributes.branch = utils.getInputTextValue("#input-publish-github-branch", event);
		publishAttributes.path = utils.getInputTextValue("#input-publish-file-path", event);
		if(event.isPropagationStopped()) {
			return undefined;
		}
		var parsedRepository = publishAttributes.repository.match(/[\/:]?([^\/:]+)\/([^\/]+?)(?:\.git)?$/);
		if(parsedRepository) {
			publishAttributes.repository = parsedRepository[2];
			publishAttributes.username = parsedRepository[1];
		}
		return publishAttributes;
	};

	/*
	 * Synchronizer Support 
	 */

	 githubProvider.importFiles = function() {
        githubHelper.picker(function(error, username, repo, branch, path) {
            if(error || !username || !repo || !branch || !path) {
                return;
            }
			
			var syncAttributes = {
				username: username,
				repository: repo,
				branch: branch,
				path: path,
				provider: githubProvider,
				sha: false
			}

			var syncIndex = githubProvider.createSyncIndex(syncAttributes);
			syncAttributes.syncIndex = syncIndex;
			var syncLocations = {};
            syncLocations[syncAttributes.syncIndex] = syncAttributes;

			var fileDesc = fileMgr.getFileFromSyncIndex(syncIndex);
			if(fileDesc !== undefined) {
				return eventMgr.onError('"' + fileDesc.title + '" is already in your local documents.');
			}
		
			githubProvider.read(syncAttributes, function(content, sha) {
				syncAttributes.sha = sha;
				fileDesc = fileMgr.createFile(githubProvider.generateTitleFromAttributes(syncAttributes), content, null, syncLocations);
				fileMgr.selectFile(fileDesc);
				eventMgr.onSyncImportSuccess([fileDesc], githubProvider);
			});
           
        });
    };
/*
    githubProvider.exportFile = function(event, title, content, discussionListJSON, frontMatter, callback) {
        var path = utils.getInputTextValue("#input-sync-export-dropbox-path", event);
        path = checkPath(path);
        if(path === undefined) {
            return callback(true);
        }
        // Check that file is not synchronized with another one
        var syncIndex = githubProvider(generateSyncIndex);
        var fileDesc = fileMgr.getFileFromSyncIndex(syncIndex);
        if(fileDesc !== undefined) {
            var existingTitle = fileDesc.title;
            eventMgr.onError('File path is already synchronized with "' + existingTitle + '".');
            return callback(true);
        }
        var data = dropboxProvider.serializeContent(content, discussionListJSON);
        dropboxHelper.upload(path, data, function(error, result) {
            if(error) {
                return callback(error);
            }
            var syncAttributes = createSyncAttributes(result.path, result.versionTag, content, discussionListJSON);
            callback(undefined, syncAttributes);
        });
    };
*/
    githubProvider.syncUp = function(content, contentCRC, title, titleCRC, discussionList, discussionListCRC, frontMatter, syncAttributes, callback) {
        if(
            (syncAttributes.contentCRC == contentCRC) && // Content CRC hasn't changed
            (syncAttributes.discussionListCRC == discussionListCRC) // Discussion list CRC hasn't changed
        ) {
            return callback(undefined, false);
        }
        var uploadedContent = dropboxProvider.serializeContent(content, discussionList);
        dropboxHelper.upload(syncAttributes.path, uploadedContent, function(error, result) {
            if(error) {
                return callback(error, true);
            }
            syncAttributes.version = result.versionTag;
            if(merge === true) {
                // Need to store the whole content for merge
                syncAttributes.content = content;
                syncAttributes.discussionList = discussionList;
            }
            syncAttributes.contentCRC = contentCRC;
            syncAttributes.titleCRC = titleCRC; // Not synchronized but has to be there for syncMerge
            syncAttributes.discussionListCRC = discussionListCRC;

            callback(undefined, true);
        });
    };

    githubProvider.syncDown = function(callback) {
        var lastChangeId = storage[PROVIDER_DROPBOX + ".lastChangeId"];
        dropboxHelper.checkChanges(lastChangeId, function(error, changes, newChangeId) {
            if(error) {
                return callback(error);
            }
            var interestingChanges = [];
            _.each(changes, function(change) {
                var syncIndex = createSyncIndex(change.path);
                var fileDesc = fileMgr.getFileFromSyncIndex(syncIndex);
                var syncAttributes = fileDesc && fileDesc.syncLocations[syncIndex];
                if(!syncAttributes) {
                    return;
                }
                // Store fileDesc and syncAttributes references to avoid 2 times search
                change.fileDesc = fileDesc;
                change.syncAttributes = syncAttributes;
                // Delete
                if(change.wasRemoved === true) {
                    interestingChanges.push(change);
                    return;
                }
                // Modify
                if(syncAttributes.version != change.stat.versionTag) {
                    interestingChanges.push(change);
                }
            });
            dropboxHelper.downloadContent(interestingChanges, function(error, changes) {
                if(error) {
                    callback(error);
                    return;
                }
                function mergeChange() {
                    if(changes.length === 0) {
                        storage[PROVIDER_DROPBOX + ".lastChangeId"] = newChangeId;
                        return callback();
                    }
                    var change = changes.pop();
                    var fileDesc = change.fileDesc;
                    var syncAttributes = change.syncAttributes;
                    // File deleted
                    if(change.wasRemoved === true) {
                        eventMgr.onError('"' + fileDesc.title + '" has been removed from Dropbox.');
                        fileDesc.removeSyncLocation(syncAttributes);
                        return eventMgr.onSyncRemoved(fileDesc, syncAttributes);
                    }
                    var file = change.stat;
                    var parsedContent = dropboxProvider.parseContent(file.content);
                    var remoteContent = parsedContent.content;
                    var remoteDiscussionListJSON = parsedContent.discussionListJSON;
                    var remoteDiscussionList = parsedContent.discussionList;
                    var remoteCRC = dropboxProvider.syncMerge(fileDesc, syncAttributes, remoteContent, fileDesc.title, remoteDiscussionList, remoteDiscussionListJSON);
                    // Update syncAttributes
                    syncAttributes.version = file.versionTag;
                    if(merge === true) {
                        // Need to store the whole content for merge
                        syncAttributes.content = remoteContent;
                        syncAttributes.discussionList = remoteDiscussionList;
                    }
                    syncAttributes.contentCRC = remoteCRC.contentCRC;
                    syncAttributes.discussionListCRC = remoteCRC.discussionListCRC;
                    utils.storeAttributes(syncAttributes);
                    setTimeout(mergeChange, 5);
                }
                setTimeout(mergeChange, 5);
            });
        });
    };

	eventMgr.addListener("onReady", function() {
	
		var documentEltTmpl = [
			'<a href="#" class="list-group-item document clearfix" data-document-sha="<%= document.sha %>" data-document-path="<%= document.path %>" data-document-type="<%= document.type %>">',
			'<div class="name"><i class="<%= document.type == "blob" ? "icon-file" : "icon-folder" %>"></i> ',
			'<%= document.path %></div>',
			'</a>'
		].join('');

		var modalElt = document.querySelector('.modal-download-github');
		var $documentListElt = $(modalElt.querySelector('.document-list'));
		var $repoSelect = $(modalElt.querySelector('#input-sync-import-github-repo'));
		var $branchSelect = $(modalElt.querySelector('#input-sync-import-github-branch'));
		var $pleaseWait = $(modalElt.querySelector(".please-wait"));


		var selectedRepo = function() {
			return $repoSelect.val();
		}

		var selectedBranch = function() {
			return $branchSelect.val();
		}

		var currentPathSegments = [];

		var currentPath = function() {
			return currentPathSegments.join("/");
		}
		
		var popPath = function() {
			currentPathSegments.pop();
			updateFileList();
		}

		var pushPath = function(folder) {
			currentPathSegments.push(folder);
			updateFileList();
		}

		var updateRepoList = _.debounce(function() {
			githubHelper.getRepos(function(err, repos) {
				if (err) {
					throw err;
				}
				$repoSelect.children('option').remove();
				var sortedRepos = _(repos).sortBy(function(i) { return i.full_name.toLowerCase() });
				_(sortedRepos).each(function(r) {
					$repoSelect.append($("<option></option>").attr('value',r.full_name).text(r.full_name));
				})
				updateBranchList();
			})
		}, 10, true);

		var updateBranchList = _.debounce(function(){
			$pleaseWait.show();
			var repo = selectedRepo();
			$branchSelect.children('option').remove();
			if (!repo) {
				$branchSelect.prop("disabled",true);
				return;
			}
			$branchSelect.prop("disabled",false);
			
			githubHelper.getBranchesForRepo(repo, function(err, branches) {
				if (err) {
					throw err;
				}
				console.log("gor branches", branches);
				var sortedBranches = _(branches).sortBy(function(i) { return i.toLowerCase() });
				var hasMaster = false;
				_(sortedBranches).each(function(r) {
					if (r == "master") { hasMaster = true; }
					$branchSelect.append($("<option></option>").attr('value',r).text(r));
				})
				if (hasMaster) {
					$branchSelect.val("master");
				}
				updateFileList();
			})
		}, 10, true);

		var updateFileList = _.debounce(function(){
			$pleaseWait.show();
			var repo = selectedRepo();
			var branch = selectedBranch();
			var path = currentPath();
			console.log("loading",repo,branch,path)
			githubHelper.getFilesForPath(repo, branch, path, function(err, files) {

				var sortedFiles = _(files).sortBy(function(f) {  return f.type == "blob" ? "Z"+f.path : "A"+f.path });        

				var documentListHtml = _.reduce(sortedFiles, function(result, document) {
					
					return result + _.template(documentEltTmpl, {
						document: document,
					});
				}, '');
				$pleaseWait.hide();
				$documentListElt.html(documentListHtml);

			});
		}, 10, true);

		$repoSelect.on("change", updateBranchList);
		$branchSelect.on("change", updateFileList);
		$documentListElt.on("click", ".document", function(e) {
			var el = e.currentTarget;
			var type = $(el).attr("data-document-type");
			var path = $(el).attr("data-document-path");
			var sha = $(el).attr("data-document-sha");
			console.log("clicked",type, path)
			if (type == "tree") {
				pushPath(path);
			}
			console.log("clicked",el);
		})
		$(modalElt)
			.on('show.bs.modal', function() {
				updateRepoList();
			});
	



	});


	return githubProvider;
});