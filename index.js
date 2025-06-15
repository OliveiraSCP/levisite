require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client,
  Collection,
  GatewayIntentBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  ChannelType,
} = require('discord.js');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

client.commands = new Collection();

const UPER_ROLE_ID = '1370365048555438131';
const COMPRAS_ROLE_ID = '1370365614224576624';
const ADMIN_ROLE_ID = '1383612856137945150'; // cargo admin e suporte

const TICKET_CHANNEL_ID = '1383625948137652325';

const ticketsAbertos = new Map(); // userId => channelId
const ticketsAssumidos = new Map(); // channelId => userId (quem assumiu o ticket)
const chamarCooldown = new Map(); // userId => timestamp cooldown chamar atendente

client.once('ready', async () => {
  console.log(`✅ Bot ligado como ${client.user.tag}`);

  const guild = client.guilds.cache.first();
  if (!guild) return console.log('Bot não está em nenhum servidor.');

  const channel = guild.channels.cache.get(TICKET_CHANNEL_ID);
  if (!channel) return console.log('Canal do painel de tickets não encontrado.');

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('ticket_select_menu')
      .setPlaceholder('Abra um ticket')
      .addOptions([
        {
          label: 'Script Premium',
          description: 'Comprar Script Premium',
          value: 'script_premium',
          emoji: '💻',
        },
        {
          label: 'Contas Blox Fruit',
          description: 'Comprar contas Blox Fruit',
          value: 'contas_blox',
          emoji: '🎮',
        },
        {
          label: 'Solicitar Uper',
          description: 'Solicitar Uper',
          value: 'solicitar_uper',
          emoji: '⚡',
        },
        {
          label: 'Suporte',
          description: 'Abrir ticket de suporte',
          value: 'suporte',
          emoji: '🛡️',
        },
      ]),
  );

  const messages = await channel.messages.fetch({ limit: 10 });
  const painelExistente = messages.find(msg =>
    msg.components.length > 0 &&
    msg.components[0].components[0].customId === 'ticket_select_menu'
  );

  if (!painelExistente) {
    await channel.send({
      content: '**Painel de Tickets**\nSelecione a opção para abrir um ticket.',
      components: [row],
    });
    console.log('✅ Painel de tickets enviado!');
  } else {
    console.log('Painel já existente, não enviando de novo.');
  }
});

client.on('interactionCreate', async interaction => {
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId !== 'ticket_select_menu') return;

    const guild = interaction.guild;
    const member = interaction.member;
    const escolha = interaction.values[0];

    if (ticketsAbertos.has(member.id)) {
      return interaction.reply({
        content: `Você já tem um ticket aberto: <#${ticketsAbertos.get(member.id)}>`,
        ephemeral: true,
      });
    }

    let canalNome = '';
    let cargosParaDar = []; // array de cargos pra marcar

    switch (escolha) {
      case 'solicitar_uper':
        canalNome = `${member.user.username} Solicitou uper`;
        cargosParaDar = [UPER_ROLE_ID];
        break;

      case 'script_premium':
      case 'contas_blox':
        canalNome = `${member.user.username} Quer comprar algo!`;
        // Marca o cargo de vendas + admin (que é o mesmo)
        cargosParaDar = [COMPRAS_ROLE_ID, ADMIN_ROLE_ID];
        break;

      case 'suporte':
        canalNome = `ticket-${member.user.username}`;
        cargosParaDar = []; // não dar cargo no suporte
        break;

      default:
        return interaction.reply({ content: 'Opção inválida.', ephemeral: true });
    }

    try {
      const ticketChannel = await guild.channels.create({
        name: canalNome,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          {
            id: guild.roles.everyone,
            deny: [PermissionsBitField.Flags.ViewChannel],
          },
          {
            id: member.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ReadMessageHistory,
              PermissionsBitField.Flags.AttachFiles,
              PermissionsBitField.Flags.EmbedLinks,
            ],
          },
          // Permissões pros cargos do array
          ...cargosParaDar.map(cargoId => ({
            id: cargoId,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ReadMessageHistory,
            ],
          })),
          {
            id: client.user.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ReadMessageHistory,
            ],
          },
        ],
      });

      ticketsAbertos.set(member.id, ticketChannel.id);

      // Marca os cargos pros membros (se ainda não tiver)
      for (const cargoId of cargosParaDar) {
        if (!member.roles.cache.has(cargoId)) {
          try {
            await member.roles.add(cargoId);
          } catch (err) {
            console.error(`Erro ao adicionar cargo ${cargoId} para ${member.user.tag}`, err);
          }
        }
      }

      // Botões do ticket
      const buttonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('chamar_atendente')
          .setLabel('Chamar atendente!')
          .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
          .setCustomId('terminar_atendimento')
          .setLabel('Terminar Atendimento')
          .setStyle(ButtonStyle.Danger),

        new ButtonBuilder()
          .setCustomId('atender_chamado')
          .setLabel('Atender chamado')
          .setStyle(ButtonStyle.Primary),
      );

      await ticketChannel.send({
        content: `Olá ${member}, seu ticket foi criado! Aguarde um atendente.`,
        components: [buttonRow],
      });

      await interaction.reply({
        content: `Seu ticket foi criado: ${ticketChannel}`,
        ephemeral: true,
      });
    } catch (error) {
      console.error('Erro criando ticket:', error);
      return interaction.reply({ content: 'Erro ao criar ticket, tenta depois.', ephemeral: true });
    }
  }

  if (interaction.isButton()) {
    const member = interaction.member;
    const channel = interaction.channel;

    if (interaction.customId === 'chamar_atendente') {
      if (!member.roles.cache.has(ADMIN_ROLE_ID)) {
        return interaction.reply({
          content: 'Só quem tem o cargo de admin pode chamar atendente.',
          ephemeral: true,
        });
      }

      const now = Date.now();
      const cooldownAmount = 20 * 60 * 1000;

      if (chamarCooldown.has(member.id)) {
        const expirationTime = chamarCooldown.get(member.id) + cooldownAmount;
        if (now < expirationTime) {
          const timeLeft = Math.ceil((expirationTime - now) / 1000);
          return interaction.reply({
            content: `Mano, só pode chamar atendente de 20 em 20 minutos. Tenta de novo em ${timeLeft} segundos.`,
            ephemeral: true,
          });
        }
      }

      chamarCooldown.set(member.id, now);

      await interaction.reply({
        content: `${member} está chamando um atendente! <@&1383612856137945150>`,
        ephemeral: false,
      });
    }

    if (interaction.customId === 'terminar_atendimento') {
      if (!member.roles.cache.has(ADMIN_ROLE_ID)) {
        return interaction.reply({
          content: 'Só a equipe de admin pode terminar o atendimento.',
          ephemeral: true,
        });
      }

      // Pra tickets de script_premium e contas_blox, só pode fechar se for quem assumiu
      // Vamos checar no map ticketsAssumidos se o canal tem alguém que assumiu
      const assumidoPor = ticketsAssumidos.get(channel.id);

      // Só pro canal que tem alguém assumido, verificar se o member é o mesmo que assumiu
      if (assumidoPor && assumidoPor !== member.id) {
        return interaction.reply({
          content: 'Só quem assumiu esse ticket pode fechá-lo.',
          ephemeral: true,
        });
      }

      try {
        ticketsAssumidos.delete(channel.id);
        // Remove o ticket aberto do usuário que abriu
        for (const [userId, chanId] of ticketsAbertos.entries()) {
          if (chanId === channel.id) {
            ticketsAbertos.delete(userId);
            break;
          }
        }
        await channel.delete();
      } catch (err) {
        return interaction.reply({
          content: 'Não consegui apagar o canal.',
          ephemeral: true,
        });
      }
    }

    if (interaction.customId === 'atender_chamado') {
      if (!member.roles.cache.has(ADMIN_ROLE_ID)) {
        return interaction.reply({
          content: 'Só a equipe de admin pode assumir o chamado.',
          ephemeral: true,
        });
      }

      // Marca que o membro assumiu o ticket
      ticketsAssumidos.set(interaction.channel.id, member.id);

      await interaction.reply({
        content: `${member} assumiu seu ticket!`,
        ephemeral: false,
      });
    }
  }
});

client.login(process.env.TOKEN);
