package com.blufftable.api;

import com.blufftable.api.ApiModels.*;
import com.blufftable.service.RoomService;
import com.blufftable.service.DeviceIdentityService;
import com.blufftable.websocket.GameSocketHandler;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/rooms")
public class RoomController {
    private final RoomService rooms;
    private final GameSocketHandler sockets;
    private final DeviceIdentityService identities;

    public RoomController(RoomService rooms, GameSocketHandler sockets, DeviceIdentityService identities) {
        this.rooms = rooms;
        this.sockets = sockets;
        this.identities = identities;
    }

    @GetMapping
    public List<RoomSummary> list(@RequestHeader(value = "Authorization", required = false) String authorization) {
        return rooms.list(playerId(authorization));
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public RoomView create(@RequestHeader(value = "Authorization", required = false) String authorization,
                           @Valid @RequestBody CreateRoomRequest request) {
        return rooms.create(playerId(authorization), request);
    }

    @PostMapping("/{roomId}/join")
    public RoomView join(@PathVariable UUID roomId,
                         @RequestHeader(value = "Authorization", required = false) String authorization) {
        RoomView view = rooms.join(roomId, playerId(authorization));
        sockets.broadcast(roomId);
        return view;
    }

    @DeleteMapping("/{roomId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID roomId,
                       @RequestHeader(value = "Authorization", required = false) String authorization) {
        rooms.delete(roomId, playerId(authorization));
        sockets.roomDeleted(roomId);
    }

    @DeleteMapping("/{roomId}/players/{targetId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void kick(@PathVariable UUID roomId, @PathVariable UUID targetId,
                     @RequestHeader(value = "Authorization", required = false) String authorization) {
        rooms.kick(roomId, playerId(authorization), targetId);
        sockets.kick(roomId, targetId);
        sockets.broadcast(roomId);
    }

    @PostMapping("/{roomId}/start")
    public RoomView start(@PathVariable UUID roomId,
                          @RequestHeader(value = "Authorization", required = false) String authorization,
                          @Valid @RequestBody StartGameRequest request) {
        RoomView view = rooms.start(roomId, playerId(authorization), request);
        sockets.broadcast(roomId);
        return view;
    }

    @PostMapping("/{roomId}/stop")
    public RoomView stop(@PathVariable UUID roomId,
                         @RequestHeader(value = "Authorization", required = false) String authorization,
                         @Valid @RequestBody StopGameRequest request) {
        RoomView view = rooms.stop(roomId, playerId(authorization), request);
        sockets.broadcast(roomId);
        return view;
    }

    @GetMapping("/{roomId}/snapshot")
    public RoomView snapshot(@PathVariable UUID roomId,
                             @RequestHeader(value = "Authorization", required = false) String authorization) {
        return rooms.view(roomId, playerId(authorization));
    }

    @PostMapping("/{roomId}/skins/purchase")
    public RoomView purchaseSkin(@PathVariable UUID roomId,
                                 @RequestHeader(value = "Authorization", required = false) String authorization,
                                 @Valid @RequestBody SkinRequest request) {
        RoomView view = rooms.skin(roomId, playerId(authorization), request, true);
        sockets.broadcast(roomId);
        return view;
    }

    @PutMapping("/{roomId}/skins/equip")
    public RoomView equipSkin(@PathVariable UUID roomId,
                              @RequestHeader(value = "Authorization", required = false) String authorization,
                              @Valid @RequestBody SkinRequest request) {
        RoomView view = rooms.skin(roomId, playerId(authorization), request, false);
        sockets.broadcast(roomId);
        return view;
    }

    @PutMapping("/{roomId}/avatars/equip")
    public RoomView equipAvatar(@PathVariable UUID roomId,
                               @RequestHeader(value = "Authorization", required = false) String authorization,
                               @Valid @RequestBody AvatarRequest request) {
        RoomView view = rooms.avatar(roomId, playerId(authorization), request);
        sockets.broadcast(roomId);
        return view;
    }

    @PostMapping("/{roomId}/avatars/purchase")
    public RoomView purchaseAvatar(@PathVariable UUID roomId,
                                  @RequestHeader(value = "Authorization", required = false) String authorization,
                                  @Valid @RequestBody AvatarRequest request) {
        RoomView view = rooms.avatar(roomId, playerId(authorization), request, true);
        sockets.broadcast(roomId);
        return view;
    }

    private UUID playerId(String authorization) {
        return identities.authenticateAuthorization(authorization).getId();
    }
}
