var request         = require('request');
var Q               = require('q');
var fs              = require('fs');

// Downloads a story in html format to filenameDestination
module.exports.downloadStory = function(storyID, filenameDestination) {
    var deferred = Q.defer();
    var destStream = fs.createWriteStream( filenameDestination );
    var readStream = request.get('https://www.fimfiction.net/download_story.php?story='+storyID+'&html');
    var bytes_read = 0;
    
    readStream.pipe(destStream);
    
    readStream.on('data', function(chunk) {
        bytes_read = bytes_read + chunk.length;
    })
    
    destStream.once('close', function() {
        console.log("Finished downloading story:", storyID, "bytes read:", bytes_read);
        
        // XXX: fimfic will return zero bytes and a 200 error code if the
        // story does not exist.
        // It would be nicer if they returned a 404 or 204 error code.
        if(bytes_read == 0)
            deferred.reject( new Error("fimfiction.net returned zero bytes for story "+storyID) );
        else
            deferred.resolve(filenameDestination);
    });
    
    readStream.once('error', function(err) {
        console.error("Error downloading story:", storyID);
        destStream.end(); // Not sure if destStream will close on error. Meh, we close it anyway here.
        deferred.reject(new Error(err));
    });
    
    return deferred.promise;
};

module.exports.getmetadata = function(storyID) {
    var deferred = Q.defer();
    var readStream = request.get('https://www.fimfiction.net/api/story.php?story='+storyID, function (error, response, body) {
    
        if(error)
        {
            deferred.reject(new Error(error));
        }
        else
        {
            if(response.statusCode == 200){
                var story = JSON.parse(body)
                if(story.error)
                {
                    deferred.reject(new Error(story.error));
                }
                else
                {
                    deferred.resolve(story.story);
                }
                
            } else {
                deferred.reject(new Error('error: '+ response.statusCode));
            }
        }
    });
    return deferred.promise;
};

