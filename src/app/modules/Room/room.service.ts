import { z } from 'zod';
import { RoomJoinRequestStatus, RoomMemberRole, RoomMemberStatus, RoomStatus } from '../../../../generated/prisma';
import AppError from '../../Errors/AppError';
import prisma from '../../prisma';
import httpStatus from '../../shared/http-status';
import { IAuthUser } from '../../utils/type';
import { ICreateRoomPayload } from './room.interface';
import { generateCode } from '../../helpers';
class RoomService {
  async createRoomIntoDB(authUser: IAuthUser, payload: ICreateRoomPayload) {
    const roomPhotoExist = await prisma.roomPhoto.findUnique({
      where: {
        id: payload.photoId,
      },
    });
    if (!roomPhotoExist) throw new AppError(httpStatus.NOT_FOUND, 'Room photo not found');

    const avatarExist = await prisma.avatar.findUnique({
      where: {
        id: payload.user.avatarId,
      },
    });
    if (!avatarExist) throw new AppError(httpStatus.NOT_FOUND, 'Avatar  not found');

    let code = generateCode();
    // Generate unique code
    while (await prisma.room.findUnique({ where: { code } })) {
      code = generateCode();
    }

    const result = await prisma.$transaction(async (txClient) => {
      const roomData = {
        name: payload.name,
        photoId: payload.photoId,
        code,
      };

      //   Create room
      const createdRoom = await txClient.room.create({
        data: roomData,
      });

      //   Create  1st room member  as owner role
      const user = payload.user;
      const memberData: Record<string, unknown> = {
        userId: authUser.id,
        role: RoomMemberRole.Owner,
        roomId: createdRoom.id,
      };

      if (user.isAnonymous) {
        memberData.isAnonymous = true;
      } else {
        memberData.name = user.name;
      }
      memberData.avatarId = user.avatarId;

      await txClient.roomMember.create({
        data: memberData as any,
      });
      return createdRoom;
    });

    return result;
  }
  async getPublicRoomByCodeFromDB(code: string) {
    // if (
    //   !z
    //     .string()
    //     .regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    //     .safeParse(code).success
    // ) {
    //   throw new AppError(httpStatus.BAD_REQUEST, 'Invalid room code');
    // }

    // const roomCode =  code.replace('-','')
    if (code.length !== 12) {
      throw new AppError(httpStatus.BAD_REQUEST, 'Invalid room code');
    }
    const room = await prisma.room.findUnique({
      where: {
        code: code,
        status: RoomStatus.Open,
      },
      include: {
        photo: true,
      },
    });

    
    return room;
  }
  async getRoomByCodeFromDB(authUser: IAuthUser, code: string) {
    // if (
    //   !z
    //     .string()
    //     .regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    //     .safeParse(code).success
    // ) {
    //   throw new AppError(httpStatus.BAD_REQUEST, 'Invalid room code');
    // }
    if (code.length !== 12) {
      throw new AppError(httpStatus.BAD_REQUEST, 'Invalid room code');
    }
    const isMember = await prisma.roomMember.findFirst({
      where: {
        userId: authUser.id,
        room: {
          code,
        },
      },
    });

    if (!isMember) {
      throw new AppError(httpStatus.FORBIDDEN, 'Not possible');
    }

    const room = await prisma.room.findUnique({
      where: {
        code,
      },
      include: {
        photo: true,
        members: {
          where:{
            status:{
              notIn:[ RoomMemberStatus.Removed,RoomMemberStatus.Leaved]
            }
          },
          include: {
            avatar: true,
          },
        },
        joinRequests: {
          where: {
            status: RoomJoinRequestStatus.Pending,
          },
          include: {
            avatar: true,
          },
        },
      },
    });

    const isOwner =
      room?.members.find((_) => _.userId === authUser.id)?.role === RoomMemberRole.Owner;

    return {
      ...room,
      isOwner,
    };
  }
}

export default new RoomService();
