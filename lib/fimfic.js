var request         = require('request');
var Q               = require('q');
var fs              = require('fs');

// Downloads epub to filename
module.exports.downloadStory = function(storyID, filenameDestination) {
    var deferred = Q.defer();
    var destStream = fs.createWriteStream( filenameDestination );
    var readStream = request.get('https://www.fimfiction.net/download_epub.php?story='+storyID);
    var bytes_read = 0;
    
    readStream.pipe(destStream);
    
    readStream.on('data', function(chunk) {
        bytes_read = bytes_read + chunk.length;
    })
    
    destStream.once('close', function() {
        console.log("Finished downloading story:", storyID, "bytes read:", bytes_read);
        
        // XXX: fimfic will return a 200 code despite serving a empty epub.
        // It would be nicer if they returned a 404 or 204 error code.
        if(bytes_read == 0)
            deferred.reject( new Error("fimfiction.net returned a empty epub file for story "+storyID) );
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

