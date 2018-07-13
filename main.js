//const TwitchBot = require('twitch-bot')
const TwitchBot = require('tmi.js');
var robot = require("robotjs");
const WebSocket = require("ws");
const fs = require("fs");

const memoryjs = require("memoryjs");
const prcObj = memoryjs.openProcess("Bejeweled2.exe");

const settings = require("./settings.json");
var scores = require("./scores.json");

var x = 0;
var y = 0;
var size = 83;
var width = 8;
var height = 8;
var offset_x = 600;
var offset_y = 100;

var grid_letters = ["A", "B", "C", "D", "E", "F", "G", "H"]
var grid = []

const startTime = Date.now();

/*for l in range(0, width):
	for n in range(0, height):
		grid.append(grid_letters[l] + str(n+1))*/

for(var i = 0; i < width; i++) {
	for(var j = 0; j < height; j++) {
		grid.push(grid_letters[i] + (j+1));
	}
}

function getGridParts(msg) {
	if(msg.length == 5) { var parts = [msg.substring(0, 2).toUpperCase(), msg.substring(3, 5).toUpperCase()]; }
	else if(msg.length == 4) { var parts = [msg.substring(0, 2).toUpperCase(), msg.substring(2, 4).toUpperCase()]; }
	else {
		return undefined;
	}

	if(grid.indexOf(parts[0]) != -1 && grid.indexOf(parts[1]) != -1) {
		return parts
	} else {
		return undefined;
	}
}

function checkLocation(parts) {
	const loc1 = parts[0];
	const loc2 = parts[1];

	if(loc1.charAt(0) == loc2.charAt(0)) {
		// vertical movement
		const nums = [parseInt(loc1.charAt(1)), parseInt(loc2.charAt(1))];

		if(nums[0] > 0 && nums[0] <= height && nums[1] > 0 && nums[1] <= height) {
			const direction = nums[0] - nums[1];

			if(direction == -1 || direction == 1) {
				return true;
			}
		}
	}

	if(loc1.charAt(1) == loc2.charAt(1)) {
		// horizontal movement
		const nums = [grid_letters.indexOf(loc1.charAt(0))+1, grid_letters.indexOf(loc2.charAt(0))+1];

		if(nums[0] > 0 && nums[0] <= width && nums[1] > 0 && nums[1] <= width) {
			const direction = nums[0] - nums[1];

			if(direction == -1 || direction == 1) {
				return true;
			}
		}
	}

	return false;
}

var currentlyMoving = false;
function moveCursor(locations) {
	currentlyMoving = true;

	const loc1 = locations[0];
	const loc2 = locations[1];

	xp = (grid_letters.indexOf(loc1.charAt(0)) * size) + offset_x
	yp = ((parseInt(loc1.charAt(1))-1) * size) + offset_y

	robot.moveMouse(xp, yp);
	robot.mouseClick("left");

	setTimeout(function() {
		xp = (grid_letters.indexOf(loc2.charAt(0)) * size) + offset_x
		yp = ((parseInt(loc2.charAt(1))-1) * size) + offset_y

		robot.moveMouse(xp, yp);
		robot.mouseClick("left");

		setTimeout(function() {
			currentlyMoving = false;
		}, 2000);
	}, 100)
}

var votes = {};
var whoWanted = {};
var voted = [];

function addVote(locations, user) {
	if(voted.indexOf(user) != -1) {
		return;
	}

	var loc1 = locations.join(",")
	var loc2 = locations.reverse().join(",")

	if(loc1 in votes) {
		votes[loc1] += 1

		if(user != "N/A") {
			whoWanted[loc1].push(user)
		}

		voted.push(user);
	}
	else if(loc2 in votes) {
		votes[loc2] += 1

		if(user != "N/A") {
			whoWanted[loc2].push(user)
		}

		voted.push(user);
	}
	else {
		votes[loc1] = 1	

		whoWanted[loc1] = [];
		if(user != "N/A") {
			whoWanted[loc1].push(user)
		}

		voted.push(user);
	}
}

var oldScore = 0;
var oldWinners = [];
var previousMove;

function runVotes() {
	if(typeof voteTimeout !== "undefined") {
		return;
	}

	var highest_amnt = 0;
	var highest_locs = [];

	for(var loc in votes) {
		if(!votes.hasOwnProperty(loc)) continue;

		
		if(votes[loc] > highest_amnt) {
			highest_amnt = votes[loc];
			highest_locs = [loc];
		} else if(votes[loc] == highest_amnt) {
			highest_locs.push(loc);
		}
	}

	var highest_loc = highest_locs[Math.floor(Math.random() * highest_locs.length)];

	if(highest_loc) {
		const parts = getGridParts(highest_loc);
		var curScore = memoryjs.readMemory(settings.addresses.score, "int");

		var scoreToAdd = 0;
		if(oldScore && oldWinners.length) {
			scoreToAdd = curScore - oldScore;

			console.log(oldWinners);
			console.log(whoWanted);

			for(var idx in oldWinners) {
				var winner = oldWinners[idx];

				if(winner in scores) {
					scores[winner] += scoreToAdd;
				} else {
					scores[winner] = scoreToAdd;
				}
			}

			fs.writeFileSync("./scores.json", JSON.stringify(scores), "utf-8");
		}
		oldScore = curScore;
		oldWinners = whoWanted[highest_loc];

		var players = Object.keys(scores);
		players.sort(function(a, b) {
			return scores[b] - scores[a];
		});
		var out = {};
		for(var idx in players) {
			var player = players[idx];
			
			if(Object.keys(out).length >= 16) {
				break;
			}

			out[player] = scores[player];
		}
		wsBroadcast(JSON.stringify({"top_scores": out}));

		moveCursor(parts);
		wsBroadcast(JSON.stringify({"last_move": parts}));

		var toSay = "Winning move: " + parts.join(",");
		if(scoreToAdd) {
			toSay = previousMove + " earned " + scoreToAdd.toLocaleString() + " points! " + toSay;
		}
		bot.say(settings.twitch.channels[0], toSay);
		previousMove = parts.join(",");
	}

	for(var k in votes) {
		delete votes[k];
	}
	for(var k in whoWanted) {
		delete whoWanted[k];
	}
	voted = [];
}

const bot = new TwitchBot.client(settings.twitch);
bot.connect();

var voteTimeout;
var scoreBefore = 0;

var messageQueue = [];
var messageDelay = 1000;
var lastMessage = {};
/*
{
	issuer: twitchuser8473
	issued_on: 1521069125826
	message: "Hello ~~world~~ Twitch!"
}
*/
var messageTimer = setInterval(function() {
	var msg = messageQueue.shift();
	if(typeof msg === "undefined") {
		return;
	}

	if(Date.now() - msg.issued_on >= 15000) {
		messageDelay = 750;
	} else {
		messageDelay = 1000;
	}

	if(msg.issuer) {
		bot.say(settings.twitch.channels[0], "@" + msg.issuer + " " + msg.message);
	} else {
		bot.say(settings.twitch.channels[0], msg.message);
	}
}, messageDelay);

var acceptingMoves = true;
var votePeriod = settings.vote_period;

bot.on("logon", function() {
	console.log("joined!");
	if(!acceptingMoves) {
		bot.say(settings.twitch.channels[0], "👋 Hello! A mod will need to !unpause me so I can start accepting votes.");
	} else {
		bot.say(settings.twitch.channels[0], "👋 Hello!");
	}
});

bot.on("message", function(channel, userstate, msg, self) {
	if(self || userstate["message-type"] != "chat") {
		return;
	}
	var user = userstate.username;
	//console.log(msg);

	locations = getGridParts(msg);
	if(typeof locations !== "undefined" && msg.charAt(0) != "!" && acceptingMoves && voted.indexOf(user) == -1) {
		if(checkLocation(locations)) {
			addVote(locations, user)
			if(typeof voteTimeout === "undefined") {
				voteTimeout = setTimeout(function() {
					voteTimeout = undefined;
					runVotes();
				}, (votePeriod - 150) + parseInt(Math.random() * 300));
			}
		}
	} else {
		if(msg.charAt(0) == "!") {
			var cmd = msg.substring(1).toLowerCase().split(" ")[0];
			if(cmd in commands) {
				commands[cmd](userstate, msg)
			}
		} else {
			let logFile = fs.createWriteStream("log" + startTime.toString() + ".txt", {flags: 'a'});
			logFile.write(Date.now() + "\t" + user + "\t" + msg);
			logFile.end();
		}
	}
});

var commands = {
	pause: function(userstate, msg) {
		if(!userstate.mod) {
			return;
		}

		if(acceptingMoves) {
			acceptingMoves = false;
			// im aware this is going outside the message queue, should be fine
			bot.say(settings.twitch.channels[0], "🛑 THE GAME IS NOW PAUSED. No votes for moves will be accepted until the game has resumed.");
		} else {
			bot.say(settings.twitch.channels[0], "The game is already paused.");
		}
	},

	unpause: function(userstate, msg) {
		if(!userstate.mod) {
			return;
		}

		if(!acceptingMoves) {
			acceptingMoves = true;
			bot.say(settings.twitch.channels[0], "👍 THE GAME IS NO LONGER PAUSED. Votes for moves are now being accepted.");
		} else {
			bot.say(settings.twitch.channels[0], "The game is ongoing.");
		}		
	},

	points: function(userstate, msg) {
		var user = userstate.username;
		if(user == "N/A") {
			return;
		}

		if(user in lastMessage) {
			if(Date.now() - lastMessage[user] < 7000) {
				return;
			}
		} else {
			lastMessage[user] = Date.now()
		}

		var amnt = 0;
		if(user in scores) {
			var amnt = scores[user];
		}

		messageQueue.push({
			issuer: user,
			issued_on: Date.now(),
			message: "You have " + amnt.toLocaleString() + " points."
		});
	},

	save: function(userstate, msg) {
		if(!userstate.mod) {
			return;
		}

		saveGame();
	},

	fix: function(userstate, msg) {
		if(!userstate.mod) {
			return;
		}

		robot.moveMouse(offset_x - 200, offset_y + 280);
		robot.mouseClick("left");	
	},

	delay: function(userstate, msg) {
		if(!userstate.mod) {
			return;
		}

		const parts = msg.split(" ");
		if(parts.length > 1) {
			votePeriod = parseInt(parts[1]);
		}

		bot.say(settings.twitch.channels[0], "Voting delay has been changed to " + parseInt(votePeriod/1000) + " seconds.");
	},

	discord: function(userstate, msg) {
		messageQueue.push({
			issuer: null,
			issued_on: Date.now(),
			message: "Join the Discord guild! https://discord.gg/sywVEF3"
		});		
	},

	twitter: function(userstate, msg) {
		messageQueue.push({
			issuer: null,
			issued_on: Date.now(),
			message: "Follow the stream on Twitter for updates/announcements. https://twitter.com/TwitchPlaysBJ2"
		});		
	}
}
commands.stop = commands.off = commands.pause;
commands.resume = commands.on = commands.unpause;
commands.score = commands.points;

function saveGame() {
	acceptingMoves = false;

	for(var k in votes) {
		delete votes[k];
	}
	for(var k in whoWanted) {
		delete whoWanted[k];
	}
	voted = [];

	if(currentlyMoving) {
		setTimeout(saveGame, 2000);
		return;
	}

	bot.say(settings.twitch.channels[0], "🛑 THE GAME IS NOW PAUSED IN ORDER TO SAVE PROGRESS. Please wait...");
	wsBroadcast(JSON.stringify({"saving": true}));

	clearTimeout(voteTimeout);
	voteTimeout = undefined;

	robot.moveMouse(offset_x - 200, offset_y + 380);
	robot.mouseClick("left");
	setTimeout(function() {
		robot.moveMouse(offset_x + 120, offset_y + 440);
		robot.mouseClick("left");
		setTimeout(function() {
			robot.moveMouse(offset_x + 380, offset_y + 440);
			robot.mouseClick("left");

			acceptingMoves = true;
			bot.say(settings.twitch.channels[0], "👍 THE GAME IS NO LONGER PAUSED. Votes for moves are now being accepted.");
			wsBroadcast(JSON.stringify({"saving": false}));
		}, 2300);
	}, 100);

	fs.writeFileSync("./backup/scores." + Date.now() + ".json", JSON.stringify(scores), "utf-8");
}

var saveInterval = setInterval(saveGame, 1000 * 60 * 60);

/*
bot.on("error", function(err) {
	console.log(err);
});
*/

const wss = new WebSocket.Server({ port: 5678 });

function wsBroadcast(msg) {
	wss.clients.forEach(function each(client) {
		if(client.readyState === WebSocket.OPEN) {
			client.send(msg);
		}
	});
}

setInterval(function() {
	if(Object.keys(votes).length > 0) {
		wsBroadcast(JSON.stringify({"votes": votes}));
	}
}, 500);
