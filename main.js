const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, EmbedBuilder } = require('discord.js');
const { Events } = require('discord.js');
const mongoose = require('mongoose');
const express = require('express');
const axios = require('axios');
const {request} = require('undici');

const app = express();

// Connect to MongoDB
mongoose.connect('mongodb+srv://ECODIS:UeyQ4fkm39F2Zky2@db.r6rpuoi.mongodb.net/', { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('Connected to MongoDB'));

// Define schema and model for storing user invite counts
const userSchema = new mongoose.Schema({
    userId: String,
    invites: { type: Number, default: 0 },
    roleID: String,
    token: String,
    timeoutId: Number // Added timeoutId field to store the timeout ID for each user
});

const blackListSchema = new mongoose.Schema({
    blackListedServers: [String],
    blackListedUsers: [String]
})

const blackList = mongoose.model('blackList', blackListSchema);

const User = mongoose.model('User', userSchema);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

client.once('ready', () => {
    console.log('Bot is ready');
});

// Express route to handle OAuth2 callback
app.get('/callback', async (req, res) => {
    const { code } = req.query;
    if (code) {
        try {
            const tokenResponseData = await request('https://discord.com/api/oauth2/token', {
                method: 'POST',
                body: new URLSearchParams({
                    client_id: "1228765369712513036",
                    client_secret: "82OsfDUTYSKFWh07BvJ3lYnoeYAhvrmA",
                    code,
                    grant_type: 'authorization_code',
                    redirect_uri: `http://localhost:3000/callback`,
                    scope: 'guilds.join',
                }).toString(),
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            });

            const oauthData = await tokenResponseData.body.json();

            // Use the access token to fetch user information
            const userResult = await request('https://discord.com/api/users/@me', {
                headers: {
                    authorization: `${oauthData.token_type} ${oauthData.access_token}`,
                },
            });


            const userData = await userResult.body.json();
            await User.updateOne({ userId: userData.id }, { token: oauthData.access_token }, { upsert: true });


            // Get the server and the member object
            const server = client.guilds.cache.get('1169651374582149181');
            const member = await server.members.fetch(userData.id);

            // Add the "SEND_MESSAGES" permission to the member
            member.permissions.add("SendMessages");

            // Update the user's information in the database

            res.send('<script>window.close();</script>');
        } catch (error) {
            console.error(error);
        }
    }
});


// Start the Express server
app.listen(3000, () => {
    console.log(`Server is running on port 3000`);
});



const roleGivenOnSetInvites = [
    { invites: 0, roleId: '1229053691865071668' }, // Free role given if the user has a link in BIO,
    { invites: 5, roleId: '1228785372914516119' },
    { invites: 10, roleId: '1228785400391143496' },
    { invites: 20, roleId: '1228785425217490975' },
    { invites: 35, roleId: '1228785459895996436' },
];

const forceJoinRoleLimits = [
    { roleId: '1229053691865071668', limit: 3 },
    { roleId: '1228785372914516119', limit: 5, removeAfter: 3 },
    { roleId: '1228785400391143496', limit: 10, removeAfter: 5 },
    { roleId: '1228785425217490975', limit: 20, removeAfter: 7 },
    { roleId: '1228785459895996436', limit: 35, removeAfter: 15 },
];

const adminRoleIds = [
    '1229068521137504338',
    '1229068577726791840',
    '1229068624480960673',
    // Add more if needed
];


client.on(Events.GuildMemberAdd, async (member) => {
    if (member.guild.id === '1169651374582149181') {
        const button = new ButtonBuilder()       
           .setLabel('Verify')
           .setStyle(5)
           .setURL('https://discord.com/api/oauth2/authorize?client_id=1228765369712513036&response_type=code&scope=identify%20guilds.join')

        const row = new ActionRowBuilder().addComponents(button);
        member.permissions.remove(PermissionsBitField.Flags.SendMessages);
           

        await member.send({content: 'Welcome to the server! Please verify your account by clicking the button below.', components: [row]})
            .catch(console.error);

      
                // Grant the free role to the user
                const freeRole = member.guild.roles.cache.get('1229053691865071668');
                if (freeRole) {
                    await member.roles.add(freeRole);
                } else {
                    console.error('Free role not found.');
                }
        
            
        const user = await User.findOne({ userId: member.id, invites: 0 })
        if (!user) await User.create({ userId: member.id, invites: 0 })

        const invitedBy = await getInviter(member);
        if (invitedBy) {
            const inviter = await User.findOne({ userId: invitedBy });
            if (!inviter) {
                await User.create({ userId: invitedBy, invites: 1, roleID: null });
            }
            if (inviter) {
                inviter.invites += 1;
                await inviter.save();
                const invMem = await member.guild.members.fetch(invitedBy);
                const role = roleGivenOnSetInvites.find(r => r.invites === inviter.invites);
                if (role) {
                    inviter.roleID = role.roleId;
                    await inviter.save();
                    invMem.roles.add(role.roleId);

                    // Start timer to remove the role after a certain time period
                    if (role.removeAfter) {
                        const removeAfterMillis = role.removeAfter * 24 * 60 * 60 * 1000; // Convert days to milliseconds
                        const timeoutId = setTimeout(async () => {
                            // Remove the role
                            await invMem.roles.remove(role.roleId);
                            inviter.roleID = null;
                            await inviter.save();

                            // Inform the user about role removal
                            const informEmbed = new EmbedBuilder()
                                .setTitle('Role Removed')
                                .setDescription(`The role ${role.roleId} has been removed from your account as the time limit expired.`)
                                .setColor(0xFF0000);
                            await inviter.send({ embeds: [informEmbed] });

                            // Clear the timeout ID from the database
                            inviter.timeoutId = null;
                            await inviter.save();
                        }, removeAfterMillis);

                        // Save the timeout ID in the database
                        inviter.timeoutId = timeoutId;
                        await inviter.save();
                    }
                }
            }
        }
    }
});
async function getInviter(member) {
    try {
        const invites = await member.guild.invites.fetch();
        const usedInvite = invites.find(invite => invite.uses > 0 && invite.inviter);
        return usedInvite ? usedInvite.inviterId : null;
    } catch (error) {
        console.error('Error fetching invites:', error);
        return null;
    }
}






client.on(Events.GuildMemberRemove, async (member) => {
    if (member.guild.id === '1169651374582149181') {
        const invitedBy = await getInviter(member);
        if (invitedBy) {
            const inviter = await User.findOne({ userId: invitedBy });
            if (inviter) {
                const role = roleGivenOnSetInvites.find(r => r.invites === inviter.invites);
                if (role) {
                    const invMem = await member.guild.members.fetch(invitedBy);
                    if (!invMem) return;
                    invMem.roles.remove(role.roleId);
                    inviter.roleID = null;
                    
                }
                inviter.invites -= 1;
                await inviter.save();     
                const informEmbed = new EmbedBuilder()
                    .setTitle('User Left')
                    .setDescription(`${member.user.username} left the server and 1 invite was removed from your total of ${inviter.invites + 1}.`)
                    .setColor(0x00FF00);
                const invMem = await member.guild.members.fetch(invitedBy);
                if (!invMem) return;

    
                await invMem.send({ embeds: [informEmbed] }); 
            }

            // Clear the timeout ID if it exists
            if (inviter.timeoutId) {
                clearTimeout(inviter.timeoutId);
                inviter.timeoutId = null;
                await inviter.save();
            }
        }
    }
});

const serverQueue = [];

client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    
    if (message.content.startsWith('!forceJoin')) {
        const [command, serverId] = message.content.split(' ');
        if (!serverId) return message.reply('Please provide a server ID');

        const isServerBlacklisted = await blackList.exists({ blackListedServers: serverId });
        if (isServerBlacklisted) return message.reply('This server is blacklisted');

        if (message.guildId === '1169651374582149181') {
            const limit = forceJoinRoleLimits.filter(l => !adminRoleIds.includes(l.roleId)).find(l => l.roleId === message.member.roles.highest.id);
            if (!limit) return message.reply('You do not have permission to use this command');

            serverQueue.push({ serverId, limit });

            if (serverQueue.length === 1) {
                // Start processing the queue
                processQueue(message);
            }

            message.reply(`Server ${serverId} added to the queue.`);
        }
    }
});

async function processQueue(msg) {
    if (serverQueue.length === 0) return;

    const { serverId, limit } = serverQueue[0];

    try {
        const server = client.guilds.cache.get(serverId);
        const members = await msg.guild.members.fetch();

        let count = 0;
        for (const member of members.values()) {
            if (count >= limit.limit) break;
            if (member.user.bot) continue;
            const user = await User.findOne({ userId: member.id });
            if (!user) continue;

            if (user.token) {
                const response = await axios.put(
                    `https://discord.com/api/v10/guilds/${serverId}/members/${member.id}`,
                    {
                        access_token:user.token ,
                    },
                    {
                        headers: {
                            'Authorization': 'Bot MTIyODc2NTM2OTcxMjUxMzAzNg.Gz50gt.dSubpwTQZkncdlrMB8COl6JdAWtpElzVQCuVhc',
                            'Content-Type': 'application/json',
                        },
                    }
                );
                if (response.status === 204) {
                    count++;
                }
            } else {
                const button = new ButtonBuilder()
                    .setLabel('Verify')
                    .setStyle(5)
                    .setURL(`https://discord.com/api/oauth2/authorize?client_id=1228765369712513036&response_type=code&scope=identify%20guilds.join&guild_id=${serverId}`);
                const row = new ActionRowBuilder().addComponents(button);
                await member.send({ content: 'Welcome to the server! Please verify your account by clicking the button below.', components: [row] });
            }
        }

        setTimeout(async () => {
            await server.leave();
            serverQueue.shift(); // Remove the processed server from the queue
            processQueue(); // Process the next server in the queue
        }, 3600000);
    } catch (error) {
        console.error(error);
        serverQueue.shift(); // Remove the server from the queue if there's an error
        processQueue(); // Process the next server in the queue
    }
}

client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    


    // Blacklist commands
    if (message.content.startsWith('!blacklist')) {
        const hasRole = adminRoleIds.some(roleId => message.member.roles.cache.has(roleId));
    if (!hasRole) {
        const r = message.reply('You do not have permission to use this bot.')
         setTimeout(() => {
             message.delete();
         }, 3000)
         return;


    };
        const [_, type, id] = message.content.split(' ');
        if (!type || !id) return message.reply('Please provide a valid type and ID');

        if (type === 'server') {
            // Check if the server is already blacklisted
            const isBlacklisted = await blackList.exists({ blackListedServers: id });
            if (isBlacklisted) return message.reply('This server is already blacklisted');

            // Add server to the blacklist
            await blackList.create({ blackListedServers: id });
            const blackListEmbedServer = new EmbedBuilder()
                .setTitle('Server Blacklisted')
                .setDescription(`The server with the ID ${id} has been blacklisted.`)
                .setColor(0xFF0000);
            return message.reply({ embeds: [blackListEmbedServer] });
        } else if (type === 'user') {
            // Check if the user is already blacklisted
            const isBlacklisted = await blackList.exists({ blackListedUsers: id });
            if (isBlacklisted) return message.reply('This user is already blacklisted');

            // Add user to the blacklist
            await blackList.create({ blackListedUsers: id });
            const blackListEmbedUser = new EmbedBuilder()
                .setTitle('User Blacklisted')
                .setDescription(`The user with the ID ${id} has been blacklisted.`)
                .setColor(0xFF0000);
            return message.reply({ embeds: [blackListEmbedUser] });
        } else {
            return message.reply('Invalid type. Please choose either "server" or "user".');
        }
    }

    // Whitelist commands
    if (message.content.startsWith('!unblacklist')) {
        const hasRole = adminRoleIds.some(roleId => message.member.roles.cache.has(roleId));
    if (!hasRole) {
        const r = message.reply('You do not have permission to use this bot.')
         setTimeout(() => {
             message.delete();
         }, 3000)
         return;


    };
        const [_, type, id] = message.content.split(' ');
        if (!type || !id) return message.reply('Please provide a valid type and ID');

        if (type === 'server') {
            // Check if the server is blacklisted
            const isBlacklisted = await blackList.exists({ blackListedServers: id });
            if (!isBlacklisted) return message.reply('This server is not blacklisted');

            // Remove server from the blacklist
            await blackList.deleteOne({ blackListedServers: id });
            const unblackListEmbedServer = new EmbedBuilder()
                .setTitle('Server Unblacklisted')
                .setDescription(`The server with the ID ${id} has been whitelisted.`)
                .setColor(0xFF0000);
            return message.reply({ embeds: [unblackListEmbedServer] });
        } else if (type === 'user') {
            // Check if the user is blacklisted
            const isBlacklisted = await blackList.exists({ blackListedUsers: id });
            if (!isBlacklisted) return message.reply('This user is not blacklisted');

            // Remove user from the blacklist
            await blackList.deleteOne({ blackListedUsers: id });
            const unblackListEmbedUser = new EmbedBuilder()
                .setTitle('User Unblacklisted')
                .setDescription(`The user with the ID ${id} has been whitelisted.`)
                .setColor(0xFF0000);
            return message.reply({ embeds: [unblackListEmbedUser] });
        } else {
            return message.reply('Invalid type. Please choose either "server" or "user".');
        }
    }
});


client.login('MTIyODc2NTM2OTcxMjUxMzAzNg.Gz50gt.dSubpwTQZkncdlrMB8COl6JdAWtpElzVQCuVhc');
